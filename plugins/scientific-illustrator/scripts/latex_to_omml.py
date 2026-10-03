"""Convert a LaTeX equation snippet into OMML (Office Math Markup Language).

Pipeline: LaTeX -> MathML (latex2mathml) -> OMML (Microsoft Word's MML2OMML.XSL).

This is the vendored equation companion of the Scientific Illustrator
PowerPoint bridge. The MCP server calls it once per `powerpoint_add_equation`
request and forwards the resulting payload to the COM or OOXML backend:

    latex_to_omml.py --json-b64 <base64-utf8-latex> [--with-docx]

prints a compact JSON object on stdout:

    {"ok": true, "omml": "<m:oMath ...>", "docx_b64": "..."}

`docx_b64` (only with --with-docx) is a minimal .docx that the Windows COM
bridge opens in a hidden Word instance to copy the native equation into the
live PowerPoint selection. The OOXML backend injects `omml` directly.

Other modes:
    latex_to_omml.py "<latex>"                    print OMML XML to stdout
    latex_to_omml.py --docx "<latex>" out.docx    write a minimal docx
    latex_to_omml.py --selfcheck                  regression battery

Requires a Microsoft Word installation for MML2OMML.XSL unless the
MML2OMML_XSL environment variable points at the file.
"""
from __future__ import annotations

import base64
import io
import json
import os
import sys
import zipfile
from functools import lru_cache
from pathlib import Path

from lxml import etree

try:
    import latex2mathml.converter as conv
except ImportError as exc:  # pragma: no cover - environment guard
    print(json.dumps({
        "ok": False,
        "error": (
            "latex2mathml is required for PowerPoint equations. Re-run the "
            f"plugin installer or `pip install latex2mathml`. ({exc})"
        ),
    }))
    sys.exit(0)

M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
M_LABEL = "m:oMath"


class OMMLConversionError(RuntimeError):
    """LaTeX could not be converted to OMML (bad input or transform failure)."""


class MissingWordError(RuntimeError):
    """MML2OMML.XSL not found; a Microsoft Office (Word) install is required."""


def find_mml2omml() -> str:
    """Locate MML2OMML.XSL under common Office roots; raise MissingWordError."""
    bases = [
        r"C:\Program Files\Microsoft Office\root",
        r"C:\Program Files (x86)\Microsoft Office\root",
        r"C:\Program Files\Microsoft Office",
        r"C:\Program Files (x86)\Microsoft Office",
    ]
    for base in bases:
        try:
            hits = sorted(Path(base).glob("Office*/MML2OMML.XSL"))
        except OSError:
            continue
        if hits:
            return str(hits[0])
    try:  # Microsoft Word for Mac keeps the transform inside the app bundle.
        hits = sorted(Path("/Applications/Microsoft Word.app").glob("**/MML2OMML.XSL"))
    except OSError:
        hits = []
    if hits:
        return str(hits[0])
    raise MissingWordError(
        "MML2OMML.XSL not found under any Office root. Install Microsoft Word, "
        "or point the MML2OMML_XSL environment variable at the file."
    )


@lru_cache(maxsize=1)
def _xslt_transform() -> etree.XSLT:
    path = os.environ.get("MML2OMML_XSL") or find_mml2omml()
    try:
        return etree.XSLT(etree.parse(path))
    except Exception as e:  # missing/malformed XSL
        raise MissingWordError(f"failed to load MML2OMML.XSL at {path!r}: {e}") from e


def latex_to_omml(latex: str) -> str:
    """Convert a LaTeX fragment to a standalone OMML <m:oMath> XML string."""
    if not latex or not latex.strip():
        raise ValueError("empty LaTeX input")
    try:
        mathml = conv.convert(latex)
    except Exception as e:
        raise OMMLConversionError(f"latex2mathml rejected {latex!r}: {e}") from e
    try:
        mml_doc = etree.fromstring(mathml.encode("utf-8"))
        omml_doc = _xslt_transform()(mml_doc)
    except MissingWordError:
        raise  # environment problem (no Word XSL), not a conversion failure
    except etree.XMLSyntaxError as e:
        raise OMMLConversionError(f"latex2mathml produced malformed MathML for {latex!r}: {e}") from e
    except Exception as e:
        raise OMMLConversionError(f"MathML->OMML transform failed for {latex!r}: {e}") from e
    out = str(omml_doc)
    if M_LABEL not in out:
        raise OMMLConversionError(f"transform produced no {M_LABEL} for {latex!r}")
    return out


def omml_for_paragraph(latex: str) -> str:
    """Return OMML XML with an inline math namespace declaration."""
    omml = latex_to_omml(latex)
    if omml.startswith("<?xml"):
        omml = omml.split("?>", 1)[1].strip()
    if f'xmlns:m="{M_NS}"' not in omml.split(">", 1)[0]:
        omml = omml.replace(f"<{M_LABEL}>", f'<{M_LABEL} xmlns:m="{M_NS}">', 1)
    return omml


def build_minimal_docx(omml_xml: str) -> bytes:
    """Build a minimal one-paragraph .docx containing the given <m:oMath>."""
    if omml_xml.startswith("<?xml"):
        omml_xml = omml_xml.split("?>", 1)[1].strip()
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{W_NS}" xmlns:m="{M_NS}">'
        f"<w:body><w:p>{omml_xml}</w:p><w:sectPr/></w:body></w:document>"
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        "</Types>"
    )
    relationships = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="word/document.xml"/>'
        "</Relationships>"
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", relationships)
        archive.writestr("word/document.xml", document)
    return buffer.getvalue()


SELFCHECK_CASES = {
    "quadratic": r"x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}",
    "integral": r"\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}",
    "matrix": r"\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}",
    "sum": r"\sum_{i=1}^{n} i = \frac{n(n+1)}{2}",
    "greek": r"\alpha + \beta = \gamma",
    "derivative": r"\frac{d}{dx}\left(x^2\right) = 2x",
    "subsup": r"e^{-i\theta} = \cos\theta - i\sin\theta",
    "vector": r"\vec{F} = m \vec{a}",
    "limit": r"\lim_{x \to 0} \frac{\sin x}{x} = 1",
}


def selfcheck() -> int:
    """Run a regression battery; return 0 when every case converts to OMML."""
    ok = True
    for name, latex in SELFCHECK_CASES.items():
        try:
            omml = omml_for_paragraph(latex)
            etree.fromstring(omml.encode("utf-8"))
            print(f"  [PASS] {name}: {latex}")
        except Exception as e:
            ok = False
            print(f"  [FAIL] {name}: {latex} -> {e}")
    print(f'selfcheck: {"ALL PASS" if ok else "FAILURES PRESENT"} ({len(SELFCHECK_CASES)} cases)')
    return 0 if ok else 1


def _json_mode(encoded: str, with_docx: bool) -> int:
    """Emit one compact JSON object for the MCP server."""
    try:
        latex = base64.b64decode(encoded.encode("ascii"), validate=True).decode("utf-8")
        omml = omml_for_paragraph(latex)
        payload = {"ok": True, "omml": omml}
        if with_docx:
            payload["docx_b64"] = base64.b64encode(build_minimal_docx(omml)).decode("ascii")
    except Exception as exc:
        payload = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    print(json.dumps(payload, ensure_ascii=False))
    return 0


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2
    if args[0] == "--selfcheck":
        return selfcheck()
    if args[0] == "--json-b64":
        if len(args) < 2:
            print(json.dumps({"ok": False, "error": "usage: latex_to_omml.py --json-b64 <base64-latex> [--with-docx]"}))
            return 0
        return _json_mode(args[1], "--with-docx" in args[2:])
    if args[0] == "--docx":
        if len(args) < 3:
            print('usage: latex_to_omml.py --docx "<latex>" out.docx', file=sys.stderr)
            return 2
        Path(args[2]).write_bytes(build_minimal_docx(omml_for_paragraph(args[1])))
        print(f"saved {args[2]}")
        return 0
    print(omml_for_paragraph(args[0]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
