#!/usr/bin/env python3
"""Focused regression tests for the file-backed PowerPoint/WPS bridge."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest import mock

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
BRIDGE_PATH = ROOT / "plugins" / "scientific-illustrator" / "scripts" / "powerpoint-mac-bridge.py"
SPEC = importlib.util.spec_from_file_location("scientific_illustrator_powerpoint_bridge", BRIDGE_PATH)
BRIDGE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(BRIDGE)


class WpsBridgeReliabilityTests(unittest.TestCase):
    def managed_session(self, temporary: str):
        state_dir = Path(temporary) / "state"
        return (
            mock.patch.object(BRIDGE, "STATE_DIR", state_dir),
            mock.patch.object(BRIDGE, "STATE_PATH", state_dir / "session.json"),
            mock.patch.dict(os.environ, {
                "SCIENTIFIC_ILLUSTRATOR_POWERPOINT_SYNC": "0",
                "SCIENTIFIC_ILLUSTRATOR_DEFER_REFRESH": "1",
            }),
        )

    def test_localized_wps_path_is_built_in(self):
        self.assertIn(
            Path("/Applications/wpsoffice.localized/wpsoffice.app"),
            BRIDGE.MAC_HOSTS["wps"]["paths"],
        )

    def test_wps_environment_override_accepts_main_executable(self):
        with tempfile.TemporaryDirectory() as temporary:
            app = Path(temporary) / "wpsoffice.localized" / "wpsoffice.app"
            executable = app / "Contents" / "MacOS" / "wpsoffice"
            executable.parent.mkdir(parents=True)
            executable.write_text("test", "utf-8")
            plist_path = app / "Contents" / "Info.plist"
            with plist_path.open("wb") as handle:
                plistlib.dump({
                    "CFBundleIdentifier": "com.kingsoft.wpsoffice.mac",
                    "CFBundleExecutable": "wpsoffice",
                    "CFBundleShortVersionString": "12.1-test",
                }, handle)
            with mock.patch.dict(os.environ, {"WPS_PRESENTATION_PATH": str(executable)}), \
                    mock.patch.object(BRIDGE.shutil, "which", return_value=None):
                host = BRIDGE._mac_host_descriptor("wps")
            self.assertTrue(host["installed"])
            self.assertEqual(host["path"], str(app))
            self.assertEqual(host["bundle_id"], "com.kingsoft.wpsoffice.mac")
            self.assertEqual(host["executable_path"], str(executable))

    def test_main_process_filter_excludes_wps_helpers(self):
        main = "/Applications/wpsoffice.localized/wpsoffice.app/Contents/MacOS/wpsoffice"
        process_list = "\n".join([
            "1316 /Applications/wpsoffice.localized/wpsoffice.app/Contents/PlugIns/WPSFinderMenu.appex/Contents/MacOS/WPSFinderMenu",
            "1451 /Applications/wpsoffice.localized/wpsoffice.app/Contents/PlugIns/recentfiles.appex/Contents/MacOS/recentfiles",
            f"96497 {main}",
            "96506 /Applications/wpsoffice.localized/wpsoffice.app/Contents/SharedSupport/wpscloudsvr.app/Contents/MacOS/wpscloudsvr",
        ])
        self.assertEqual(BRIDGE._parse_macos_process_ids(process_list, main), [96497])

    def test_powerpoint_open_verification_uses_application_path_not_only_lsof(self):
        completed = subprocess.CompletedProcess(["osascript"], 0, stdout="true\n", stderr="")
        with mock.patch.object(BRIDGE.sys, "platform", "darwin"), \
                mock.patch.object(BRIDGE, "_run", return_value=completed) as runner:
            verified = BRIDGE._document_open_verification(Path("/tmp/exact-deck.pptx"), [1234], "powerpoint")
        self.assertTrue(verified)
        command = runner.call_args.args[0]
        self.assertEqual(command[-1], "exact-deck.pptx")
        expected_directory = Path("/tmp")
        self.assertEqual(Path(command[-3]), expected_directory)
        self.assertEqual(Path(command[-2]), expected_directory.resolve())

    def test_powerpoint_open_verification_timeout_is_unknown(self):
        with mock.patch.object(BRIDGE.sys, "platform", "darwin"), \
                mock.patch.object(BRIDGE, "_run", side_effect=subprocess.TimeoutExpired(["osascript"], 8)):
            verified = BRIDGE._document_open_verification(Path("/tmp/exact-deck.pptx"), [1234], "powerpoint")
        self.assertIsNone(verified)

    def test_windows_wps_discovery_supports_versioned_and_configured_installs(self):
        with tempfile.TemporaryDirectory() as temporary:
            program_files = Path(temporary) / "Program Files"
            versioned = program_files / "Kingsoft" / "WPS Office" / "12.2.0.19000" / "office6" / "wpp.exe"
            versioned.parent.mkdir(parents=True)
            versioned.write_text("test", "utf-8")
            configured_root = Path(temporary) / "portable-wps"
            configured = configured_root / "13.0.0" / "office6" / "wpsoffice.exe"
            configured.parent.mkdir(parents=True)
            configured.write_text("test", "utf-8")
            environment = {
                "ProgramFiles": str(program_files),
                "ProgramFiles(x86)": "",
                "LOCALAPPDATA": "",
                "WPS_PRESENTATION_PATH": str(configured_root),
            }
            with mock.patch.dict(os.environ, environment, clear=False), \
                    mock.patch.object(BRIDGE.shutil, "which", return_value=None):
                candidates = BRIDGE._windows_wps_candidates()
            self.assertIn(versioned, candidates)
            self.assertIn(configured, candidates)

    def test_windows_tasklist_parser_matches_only_main_image_names(self):
        output = "\n".join([
            '"wpp.exe","4820","Console","1","120,000 K"',
            '"wpsoffice.exe","5001","Console","1","90,000 K"',
            '"wpscloudsvr.exe","6000","Console","1","10,000 K"',
            "INFO: No tasks are running which match the specified criteria.",
        ])
        self.assertEqual(BRIDGE._parse_windows_tasklist_process_ids(output, "wpp.exe"), [4820])
        self.assertEqual(BRIDGE._parse_windows_tasklist_process_ids(output, "wpsoffice.exe"), [5001])

    def test_status_does_not_treat_an_existing_file_as_an_open_document(self):
        with tempfile.NamedTemporaryFile(suffix=".pptx") as presentation:
            state = {
                "path": presentation.name,
                "source_path": None,
                "metadata": {},
                "owned": True,
                "refresh_pending": False,
                "last_refresh": {"open_dispatched": True, "refresh_verified": False},
            }
            host = {
                "host_application": "wps",
                "target_application": "wps",
                "microsoft_powerpoint_used": False,
                "main_process_running": True,
                "running_processes": 1,
                "process_ids": [96497],
            }
            with mock.patch.object(BRIDGE, "_state", return_value=state), \
                    mock.patch.object(BRIDGE, "_presentation_host_info", return_value=host), \
                    mock.patch.object(BRIDGE, "_document_open_verification", return_value=False):
                status = BRIDGE.action_status({"host_application": "wps"})
            self.assertTrue(status["managed_file_exists"])
            self.assertFalse(status["active_presentation"])
            self.assertFalse(status["document_open_verified"])
            self.assertFalse(status["connected_to_active_application"])
            self.assertEqual(status["connection_mode"], "file-backed-working-copy")

    def test_windows_wps_refresh_never_claims_powerpoint_or_verified_reload(self):
        with tempfile.NamedTemporaryFile(suffix=".pptx") as presentation:
            file_path = Path(presentation.name)
            state = {"host_application": "wps", "refresh_pending": True}
            host = {
                "installed": True,
                "path": r"C:\Program Files\Kingsoft\WPS Office\office6\wpp.exe",
                "bundle_id": None,
                "executable_path": r"C:\Program Files\Kingsoft\WPS Office\office6\wpp.exe",
            }
            dispatched = {
                "open_dispatched": True,
                "dispatch_method": "direct-executable-no-activate",
                "dispatch_return_code": None,
            }
            with mock.patch.object(BRIDGE.sys, "platform", "win32"), \
                    mock.patch.object(BRIDGE, "_select_host", return_value=("wps", host)), \
                    mock.patch.object(BRIDGE, "_main_process_ids", return_value=[4820]), \
                    mock.patch.object(BRIDGE, "_document_open_verification", return_value=None), \
                    mock.patch.object(BRIDGE, "_open_windows_presentation", return_value=dispatched) as opener, \
                    mock.patch.object(BRIDGE, "_write_state"):
                result = BRIDGE._refresh_presentation(file_path, state)
            opener.assert_called_once_with(file_path, host["executable_path"], "preserve")
            self.assertEqual(result["target_application"], "wps")
            self.assertFalse(result["microsoft_powerpoint_used"])
            self.assertTrue(result["open_dispatched"])
            self.assertIsNone(result["document_open_verified"])
            self.assertIsNone(result["refresh_verified"])
            self.assertTrue(result["request_succeeded"])
            self.assertTrue(state["refresh_pending"])

    def test_failed_open_request_never_reports_refresh_success(self):
        with tempfile.NamedTemporaryFile(suffix=".pptx") as presentation:
            file_path = Path(presentation.name)
            state = {"host_application": "wps", "refresh_pending": True}
            host = {
                "installed": True,
                "path": "/Applications/wpsoffice.localized/wpsoffice.app",
                "bundle_id": "com.kingsoft.wpsoffice.mac",
                "executable_path": "/Applications/wpsoffice.localized/wpsoffice.app/Contents/MacOS/wpsoffice",
            }
            failed = {
                "open_dispatched": False,
                "dispatch_method": "launch-services-bundle-id",
                "dispatch_return_code": 1,
                "dispatch_error": "simulated failure",
            }
            with mock.patch.object(BRIDGE.sys, "platform", "darwin"), \
                    mock.patch.object(BRIDGE, "_select_host", return_value=("wps", host)), \
                    mock.patch.object(BRIDGE, "_main_process_ids", return_value=[]), \
                    mock.patch.object(BRIDGE, "_document_open_verification", return_value=False), \
                    mock.patch.object(BRIDGE, "_dispatch_macos_open", return_value=failed), \
                    mock.patch.object(BRIDGE, "_write_state"):
                result = BRIDGE._refresh_presentation(file_path, state)
            self.assertFalse(result["open_dispatched"])
            self.assertFalse(result["refresh_verified"])
            self.assertFalse(result["request_succeeded"])
            self.assertTrue(state["refresh_pending"])

    def test_powerpoint_refresh_never_discards_unsaved_user_changes(self):
        with tempfile.NamedTemporaryFile(suffix=".pptx") as presentation:
            file_path = Path(presentation.name)
            state = {"host_application": "powerpoint", "refresh_pending": True}
            host = {"installed": True, "path": "/Applications/Microsoft PowerPoint.app", "bundle_id": "com.microsoft.Powerpoint"}
            close_result = subprocess.CompletedProcess(["osascript"], 0, stdout="unsaved\n", stderr="")
            with mock.patch.object(BRIDGE.sys, "platform", "darwin"), \
                    mock.patch.object(BRIDGE, "_select_host", return_value=("powerpoint", host)), \
                    mock.patch.object(BRIDGE, "_main_process_ids", return_value=[1234]), \
                    mock.patch.object(BRIDGE, "_document_open_verification", return_value=True), \
                    mock.patch.object(BRIDGE, "_run", return_value=close_result), \
                    mock.patch.object(BRIDGE, "_dispatch_macos_open") as dispatcher, \
                    mock.patch.object(BRIDGE, "_write_state"):
                result = BRIDGE._refresh_presentation(file_path, state)
            dispatcher.assert_not_called()
            self.assertTrue(result["reload_blocked_by_unsaved_changes"])
            self.assertFalse(result["open_dispatched"])
            self.assertFalse(result["refresh_verified"])
            self.assertTrue(state["refresh_pending"])

    def test_powerpoint_refresh_does_not_query_unrelated_decks_when_target_is_closed(self):
        with tempfile.NamedTemporaryFile(suffix=".pptx") as presentation:
            file_path = Path(presentation.name)
            state = {"host_application": "powerpoint", "refresh_pending": True}
            host = {"installed": True, "path": "/Applications/Microsoft PowerPoint.app", "bundle_id": "com.microsoft.Powerpoint"}
            dispatched = {"open_dispatched": True, "dispatch_method": "launch-services-bundle-id", "dispatch_return_code": 0}
            with mock.patch.object(BRIDGE.sys, "platform", "darwin"), \
                    mock.patch.object(BRIDGE, "_select_host", return_value=("powerpoint", host)), \
                    mock.patch.object(BRIDGE, "_main_process_ids", return_value=[1234]), \
                    mock.patch.object(BRIDGE, "_document_open_verification", return_value=False), \
                    mock.patch.object(BRIDGE, "_wait_for_document_open", return_value=True), \
                    mock.patch.object(BRIDGE, "_dispatch_macos_open", return_value=dispatched) as dispatcher, \
                    mock.patch.object(BRIDGE, "_run") as apple_script, \
                    mock.patch.object(BRIDGE, "_write_state"):
                result = BRIDGE._refresh_presentation(file_path, state)
            apple_script.assert_not_called()
            dispatcher.assert_called_once_with(file_path, host, "preserve")
            self.assertTrue(result["document_open_verified"])
            self.assertTrue(result["refresh_verified"])
            self.assertFalse(state["refresh_pending"])

    def test_close_presentation_returns_verified_already_closed_without_applescript(self):
        with tempfile.NamedTemporaryFile(suffix=".pptx") as presentation:
            file_path = Path(presentation.name)
            state = {"path": str(file_path), "host_application": "powerpoint"}
            available = {"powerpoint": {"installed": True}, "wps": {"installed": True}}
            with mock.patch.object(BRIDGE.sys, "platform", "darwin"), \
                    mock.patch.object(BRIDGE, "_require_path", return_value=(state, file_path)), \
                    mock.patch.object(BRIDGE, "_select_host", return_value=("powerpoint", available["powerpoint"])), \
                    mock.patch.object(BRIDGE, "_available_hosts", return_value=available), \
                    mock.patch.object(BRIDGE, "_main_process_ids", return_value=[1234]), \
                    mock.patch.object(BRIDGE, "_document_open_verification", return_value=False), \
                    mock.patch.object(BRIDGE, "_run") as apple_script:
                result = BRIDGE.action_close_presentation({"confirm": True})
            apple_script.assert_not_called()
            self.assertTrue(result["closed"])
            self.assertTrue(result["already_closed"])
            self.assertTrue(result["close_verified"])

    def test_activate_slide_reports_unverified_open_as_not_activated(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "test.pptx"
            BRIDGE._new_presentation(path)
            state = {"path": str(path), "host_application": "wps"}
            refresh = {"document_open_verified": False, "open_dispatched": True, "refresh_verified": False}
            with mock.patch.object(BRIDGE, "_require_path", return_value=(state, path)), \
                    mock.patch.object(BRIDGE, "_refresh_presentation", return_value=refresh):
                result = BRIDGE.action_activate_slide({"slide_index": 1})
            self.assertFalse(result["activated"])
            self.assertFalse(result["document_activation_verified"])

    def test_deferred_save_marks_refresh_pending_without_dispatch(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "deferred.pptx"
            presentation = BRIDGE._new_presentation(path)
            state = {"path": str(path), "host_application": "wps"}
            with mock.patch.dict(os.environ, {"SCIENTIFIC_ILLUSTRATOR_DEFER_REFRESH": "1"}), \
                    mock.patch.object(BRIDGE, "_refresh_presentation") as refresh:
                BRIDGE._save(presentation, state, path)
            refresh.assert_not_called()
            self.assertTrue(state["refresh_pending"])

    def test_read_only_launch_blocks_all_mutations(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source.pptx"
            BRIDGE._new_presentation(source)
            original = source.read_bytes()
            state_dir_patch, state_path_patch, environment_patch = self.managed_session(temporary)
            with state_dir_patch, state_path_patch, environment_patch:
                launched = BRIDGE.action_launch({
                    "host_application": "wps",
                    "file_path": str(source),
                    "read_only": True,
                    "visible": False,
                })
                self.assertTrue(launched["read_only"])
                with self.assertRaisesRegex(PermissionError, "read_only=true"):
                    BRIDGE.action_add_shape({"slide_index": 1, "shape": "rectangle", "left": 10, "top": 10, "width": 20, "height": 20})
            self.assertEqual(source.read_bytes(), original)

    def test_editable_ooxml_launch_refuses_macro_or_slideshow_formats(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "macro-deck.pptm"
            source.write_bytes(b"format safety is checked before parsing")
            state_dir_patch, state_path_patch, environment_patch = self.managed_session(temporary)
            with state_dir_patch, state_path_patch, environment_patch:
                with self.assertRaisesRegex(ValueError, "could discard macros"):
                    BRIDGE.action_launch({"host_application": "wps", "file_path": str(source), "read_only": False, "visible": False})

    def test_quit_refuses_unknown_presentation_count(self):
        host = {
            "host_application": "powerpoint",
            "presentation_count": None,
            "process_ids": [1234],
        }
        with mock.patch.object(BRIDGE.sys, "platform", "darwin"), \
                mock.patch.object(BRIDGE, "_state", return_value={}), \
                mock.patch.object(BRIDGE, "_presentation_host_info", return_value=host):
            with self.assertRaisesRegex(RuntimeError, "could not be verified"):
                BRIDGE.action_quit_application({"confirm": True, "expected_process_id": 1234})

    def test_unknown_ooxml_shape_is_rejected_instead_of_becoming_rectangle(self):
        with self.assertRaisesRegex(ValueError, "Unsupported OOXML auto shape"):
            BRIDGE._shape_enum({"shape": "imaginary_complex_symbol"})
        self.assertEqual(BRIDGE._shape_enum({"shape": "msoShapeRoundedRectangle"}), BRIDGE.MSO_SHAPE.ROUNDED_RECTANGLE)

    def test_duplicate_ooxml_shape_name_is_an_ambiguous_target(self):
        presentation = BRIDGE.Presentation()
        slide = presentation.slides.add_slide(presentation.slide_layouts[6])
        first = slide.shapes.add_shape(BRIDGE.MSO_SHAPE.RECTANGLE, BRIDGE._pt(10), BRIDGE._pt(10), BRIDGE._pt(20), BRIDGE._pt(20))
        second = slide.shapes.add_shape(BRIDGE.MSO_SHAPE.RECTANGLE, BRIDGE._pt(40), BRIDGE._pt(10), BRIDGE._pt(20), BRIDGE._pt(20))
        first.name = second.name = "duplicate-semantic-name"
        with self.assertRaisesRegex(ValueError, "target is ambiguous"):
            BRIDGE._shape(slide, {"shape_name": "duplicate-semantic-name"})

    def test_ooxml_styles_include_transparency_dash_and_table_borders(self):
        presentation = BRIDGE.Presentation()
        slide = presentation.slides.add_slide(presentation.slide_layouts[6])
        shape = slide.shapes.add_shape(BRIDGE.MSO_SHAPE.RECTANGLE, BRIDGE._pt(10), BRIDGE._pt(10), BRIDGE._pt(100), BRIDGE._pt(50))
        BRIDGE._set_fill(shape, "#112233", 25)
        BRIDGE._set_line(shape, {
            "line_color": "#445566",
            "line_transparency": 40,
            "line_dash": "long_dash_dot_dot",
        })
        xml = shape._element.xml
        self.assertIn('val="75000"', xml)
        self.assertIn('val="60000"', xml)
        self.assertIn('val="lgDashDotDot"', xml)

        cell = slide.shapes.add_table(1, 1, BRIDGE._pt(10), BRIDGE._pt(80), BRIDGE._pt(100), BRIDGE._pt(40)).table.cell(0, 0)
        BRIDGE._style_cell(cell, {"text": "test", "fill_color": "#00FF00", "fill_transparency": 30, "border_color": "#FF0000", "border_width": 2})
        for tag in ("lnL", "lnR", "lnT", "lnB"):
            self.assertIn(f"<{tag if ':' in tag else 'a:' + tag}", cell._tc.xml)
        self.assertIn('val="FF0000"', cell._tc.xml)
        self.assertIn('val="70000"', cell._tc.xml)

    def test_table_layout_rejects_partial_dimension_arrays(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir_patch, state_path_patch, environment_patch = self.managed_session(temporary)
            with state_dir_patch, state_path_patch, environment_patch:
                BRIDGE.action_new_presentation({"host_application": "wps"})
                BRIDGE.action_add_table({
                    "slide_index": 1,
                    "name": "results-table",
                    "rows": 2,
                    "columns": 3,
                    "left": 20,
                    "top": 20,
                    "width": 300,
                    "height": 100,
                })
                with self.assertRaisesRegex(ValueError, "does not match table column count 3"):
                    BRIDGE.action_update_table_layout({
                        "slide_index": 1,
                        "shape_name": "results-table",
                        "column_widths": [100, 200],
                    })

    def test_table_rejects_truncation_and_bands_first_body_row(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir_patch, state_path_patch, environment_patch = self.managed_session(temporary)
            with state_dir_patch, state_path_patch, environment_patch:
                BRIDGE.action_new_presentation({"host_application": "wps"})
                with self.assertRaisesRegex(ValueError, "3 rows but rows=2"):
                    BRIDGE.action_add_table({
                        "slide_index": 1, "rows": 2, "columns": 2,
                        "left": 10, "top": 10, "width": 200, "height": 80,
                        "data": [[1], [2], [3]],
                    })
                with self.assertRaisesRegex(ValueError, "outside the table bounds"):
                    BRIDGE.action_add_table({
                        "slide_index": 1, "rows": 2, "columns": 2,
                        "left": 10, "top": 10, "width": 200, "height": 80,
                        "cell_styles": [{"row": 3, "column": 1, "fill_color": "#FF0000"}],
                    })
                BRIDGE.action_add_table({
                    "slide_index": 1, "name": "band-test", "rows": 4, "columns": 1,
                    "left": 10, "top": 10, "width": 200, "height": 160,
                    "fill_color": "#FFFFFF", "header_rows": 2,
                    "header_fill_color": "#CCCCCC", "banded_rows": True, "band_fill_color": "#00FF00",
                })
                state = BRIDGE._state()
                presentation = BRIDGE.Presentation(state["path"])
                table = presentation.slides[0].shapes[0].table
                self.assertEqual(str(table.cell(2, 0).fill.fore_color.rgb), "00FF00")
                self.assertEqual(str(table.cell(3, 0).fill.fore_color.rgb), "FFFFFF")

    def test_update_line_changes_arrowheads_instead_of_silently_ignoring_them(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir_patch, state_path_patch, environment_patch = self.managed_session(temporary)
            with state_dir_patch, state_path_patch, environment_patch:
                BRIDGE.action_new_presentation({"host_application": "wps"})
                BRIDGE.action_add_line({
                    "slide_index": 1,
                    "name": "editable-arrow",
                    "begin_x": 20,
                    "begin_y": 20,
                    "end_x": 200,
                    "end_y": 20,
                })
                BRIDGE.action_update_shape({
                    "slide_index": 1,
                    "shape_name": "editable-arrow",
                    "start_arrow": "diamond",
                    "end_arrow": "triangle",
                })
                _, _, presentation = BRIDGE._load(False)
                arrow = next(shape for shape in presentation.slides[0].shapes if shape.name == "editable-arrow")
                self.assertEqual(BRIDGE._get_arrow(arrow, "a:headEnd"), "diamond")
                self.assertEqual(BRIDGE._get_arrow(arrow, "a:tailEnd"), "triangle")

    def test_connector_uses_ooxml_connection_sites_and_audits_binding(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir_patch, state_path_patch, environment_patch = self.managed_session(temporary)
            with state_dir_patch, state_path_patch, environment_patch:
                BRIDGE.action_new_presentation({"host_application": "wps"})
                source = BRIDGE.action_add_shape({"slide_index": 1, "name": "source", "shape": "rectangle", "left": 50, "top": 100, "width": 80, "height": 50})
                target = BRIDGE.action_add_shape({"slide_index": 1, "name": "target", "shape": "rectangle", "left": 250, "top": 100, "width": 80, "height": 50})
                result = BRIDGE.action_add_connector({"slide_index": 1, "name": "source-to-target", "source_name": "source", "target_name": "target", "connector_type": "straight"})
                self.assertEqual(result["attachment_mode"], "ooxml-connection-site")
                self.assertEqual((result["source_site"], result["target_site"]), (2, 4))
                _, _, presentation = BRIDGE._load()
                connector = next(shape for shape in presentation.slides[0].shapes if shape.name == "source-to-target")
                properties = connector._element.nvCxnSpPr.cNvCxnSpPr
                self.assertEqual(properties.find("a:stCxn", properties.nsmap).get("id"), str(source["shape_id"]))
                self.assertEqual(properties.find("a:endCxn", properties.nsmap).get("id"), str(target["shape_id"]))
                audit = BRIDGE.action_audit_figure({"slide_index": 1})
                self.assertNotIn("connector_detached", {item["category"] for item in audit["findings"]})

    def test_resized_group_ungroups_without_jumping_back(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir_patch, state_path_patch, environment_patch = self.managed_session(temporary)
            with state_dir_patch, state_path_patch, environment_patch:
                BRIDGE.action_new_presentation({"host_application": "wps"})
                BRIDGE.action_add_shape({"slide_index": 1, "name": "first", "shape": "rectangle", "left": 100, "top": 100, "width": 50, "height": 40})
                BRIDGE.action_add_shape({"slide_index": 1, "name": "second", "shape": "rectangle", "left": 200, "top": 160, "width": 70, "height": 30})
                BRIDGE.action_group_shapes({"slide_index": 1, "shape_names": ["first", "second"], "name": "scaled-group"})
                BRIDGE.action_update_shape({"slide_index": 1, "shape_name": "scaled-group", "left": 300, "top": 250, "width": 340, "height": 180})
                BRIDGE.action_ungroup_shape({"slide_index": 1, "shape_name": "scaled-group"})
                shapes = {item["shape_name"]: item for item in BRIDGE.action_inspect({})["slides"][0]["shapes"]}
                self.assertAlmostEqual(shapes["first"]["left"], 300, places=2)
                self.assertAlmostEqual(shapes["first"]["top"], 250, places=2)
                self.assertAlmostEqual(shapes["first"]["width"], 100, places=2)
                self.assertAlmostEqual(shapes["second"]["left"], 500, places=2)
                self.assertAlmostEqual(shapes["second"]["top"], 370, places=2)

    def test_duplicate_group_remaps_every_nested_shape_id(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir_patch, state_path_patch, environment_patch = self.managed_session(temporary)
            with state_dir_patch, state_path_patch, environment_patch:
                BRIDGE.action_new_presentation({"host_application": "wps"})
                BRIDGE.action_add_shape({"slide_index": 1, "name": "member-a", "shape": "rectangle", "left": 20, "top": 20, "width": 50, "height": 30})
                BRIDGE.action_add_shape({"slide_index": 1, "name": "member-b", "shape": "rectangle", "left": 90, "top": 20, "width": 50, "height": 30})
                BRIDGE.action_group_shapes({"slide_index": 1, "shape_names": ["member-a", "member-b"], "name": "motif"})
                BRIDGE.action_duplicate_shape({"slide_index": 1, "shape_name": "motif", "new_name": "motif-copy", "left": 200})
                _, _, presentation = BRIDGE._load(False)
                identifiers = [int(item.get("id")) for item in presentation.slides[0]._element.xpath(".//p:cNvPr")]
                self.assertEqual(len(identifiers), len(set(identifiers)))
                duplicate = next(shape for shape in presentation.slides[0].shapes if shape.name == "motif-copy")
                self.assertEqual([member.name for member in duplicate.shapes], ["motif-copy__member-a", "motif-copy__member-b"])

    def test_duplicate_chart_is_rejected_instead_of_sharing_embedded_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir_patch, state_path_patch, environment_patch = self.managed_session(temporary)
            with state_dir_patch, state_path_patch, environment_patch:
                BRIDGE.action_new_presentation({"host_application": "wps"})
                BRIDGE.action_add_chart({
                    "slide_index": 1,
                    "name": "source-chart",
                    "chart_type": "line",
                    "categories": ["A", "B"],
                    "series": [{"name": "signal", "values": [1, 2]}],
                    "left": 20,
                    "top": 20,
                    "width": 250,
                    "height": 160,
                })
                with self.assertRaisesRegex(ValueError, "share one embedded data part"):
                    BRIDGE.action_duplicate_shape({"slide_index": 1, "shape_name": "source-chart", "new_name": "unsafe-chart-copy"})

    def test_atomic_picture_crop_alt_text_and_aspect_lock_are_serialized(self):
        with tempfile.TemporaryDirectory() as temporary:
            image_path = Path(temporary) / "microscopy.png"
            Image.new("RGB", (100, 50), "white").save(image_path)
            state_dir_patch, state_path_patch, environment_patch = self.managed_session(temporary)
            with state_dir_patch, state_path_patch, environment_patch:
                BRIDGE.action_new_presentation({"host_application": "wps"})
                BRIDGE.action_add_image({
                    "slide_index": 1,
                    "name": "atomic-microscopy",
                    "image_path": str(image_path),
                    "left": 20,
                    "top": 20,
                    "width": 200,
                    "height": 100,
                    "raster_reason": "Microscopy texture cannot be reconstructed natively.",
                    "source_is_tightly_cropped": False,
                    "atomic_raster_unit": True,
                    "contains_reconstructable_content": False,
                    "decomposition_note": "Labels and frame were rebuilt as separate native objects.",
                    "crop_left_points": 20,
                    "lock_aspect_ratio": False,
                    "alt_text": "Atomic microscopy field",
                })
                _, _, presentation = BRIDGE._load()
                picture = next(shape for shape in presentation.slides[0].shapes if shape.name == "atomic-microscopy")
                self.assertAlmostEqual(picture.crop_left, 0.1, places=4)
                self.assertEqual(picture._element.nvPicPr.cNvPr.get("descr"), "Atomic microscopy field")
                locks = picture._element.nvPicPr.find("p:cNvPicPr", picture._element.nsmap).find("a:picLocks", picture._element.nsmap)
                self.assertEqual(locks.get("noChangeAspect"), "0")

    def test_audit_detects_a_straight_route_through_an_object(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir_patch, state_path_patch, environment_patch = self.managed_session(temporary)
            with state_dir_patch, state_path_patch, environment_patch:
                BRIDGE.action_new_presentation({"host_application": "wps"})
                BRIDGE.action_add_shape({"slide_index": 1, "name": "obstacle", "shape": "rectangle", "left": 100, "top": 100, "width": 80, "height": 50})
                BRIDGE.action_add_line({"slide_index": 1, "name": "bad-route", "begin_x": 50, "begin_y": 125, "end_x": 230, "end_y": 125, "end_arrow": "triangle"})
                audit = BRIDGE.action_audit_figure({"slide_index": 1})
                self.assertIn("connector_path_through_object", {item["category"] for item in audit["findings"]})

    def test_scatter_chart_and_chart_length_validation(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir_patch, state_path_patch, environment_patch = self.managed_session(temporary)
            with state_dir_patch, state_path_patch, environment_patch:
                BRIDGE.action_new_presentation({"host_application": "wps"})
                chart = BRIDGE.action_add_chart({
                    "slide_index": 1,
                    "name": "native-scatter",
                    "chart_type": "xlScatter",
                    "categories": [0, 1, 2],
                    "series": [{"name": "signal", "values": [1, 3, 2]}],
                    "left": 20,
                    "top": 20,
                    "width": 300,
                    "height": 180,
                    "category_axis_title": "Time",
                    "value_axis_title": "Signal",
                })
                self.assertEqual(chart["series_count"], 1)
                _, _, presentation = BRIDGE._load(False)
                native_chart = next(shape.chart for shape in presentation.slides[0].shapes if shape.name == "native-scatter")
                self.assertEqual(native_chart.category_axis.axis_title.text_frame.text, "Time")
                self.assertEqual(native_chart.value_axis.axis_title.text_frame.text, "Signal")
                with self.assertRaisesRegex(ValueError, "values for 3 categories"):
                    BRIDGE.action_add_chart({
                        "slide_index": 1,
                        "chart_type": "line",
                        "categories": ["A", "B", "C"],
                        "series": [{"name": "bad", "values": [1, 2]}],
                        "left": 20,
                        "top": 220,
                        "width": 300,
                        "height": 180,
                    })
                with self.assertRaisesRegex(ValueError, "does not expose category axis"):
                    BRIDGE.action_add_chart({
                        "slide_index": 1,
                        "name": "pie-with-invalid-axis",
                        "chart_type": "pie",
                        "categories": ["A", "B"],
                        "series": [{"name": "share", "values": [1, 2]}],
                        "left": 340,
                        "top": 20,
                        "width": 250,
                        "height": 180,
                        "category_axis_title": "Unsupported",
                    })

    def test_preview_dimensions_preserve_slide_aspect_ratio(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "four-three.pptx"
            BRIDGE._new_presentation(path)
            requested_width, requested_height, width, height, preserved = BRIDGE._render_dimensions(
                path,
                {"slide_index": 1, "width": 1920, "height": 1080},
            )
            self.assertEqual((requested_width, requested_height), (1920, 1080))
            self.assertEqual((width, height), (1440, 1080))
            self.assertTrue(preserved)
            _, _, width_only, height_only, _ = BRIDGE._render_dimensions(path, {"slide_index": 1, "width": 2000})
            self.assertEqual((width_only, height_only), (2000, 1500))

    def test_save_requires_output_extension_to_match_format(self):
        with tempfile.TemporaryDirectory() as temporary:
            state_dir_patch, state_path_patch, environment_patch = self.managed_session(temporary)
            with state_dir_patch, state_path_patch, environment_patch:
                BRIDGE.action_new_presentation({"host_application": "wps"})
                with self.assertRaisesRegex(ValueError, "requires an \\.pptx"):
                    BRIDGE.action_save({"output_path": str(Path(temporary) / "misnamed.pdf"), "format": "pptx"})
                with self.assertRaisesRegex(ValueError, "requires an \\.pdf"):
                    BRIDGE.action_save({"output_path": str(Path(temporary) / "misnamed.pptx"), "format": "pdf"})
                with self.assertRaisesRegex(ValueError, "PDF export requires"):
                    BRIDGE.action_save({"format": "pdf"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
