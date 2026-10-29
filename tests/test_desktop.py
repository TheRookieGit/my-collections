import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'desktop'))
import wishlist_app


class WindowAppTests(unittest.TestCase):
    """The Windows launcher: which browser opens the hub, and how."""
    def install(self,root,vendor,name,exe):
        path = Path(root)/vendor/name/'Application'/exe
        path.parent.mkdir(parents=True)
        path.write_bytes(b'')
        return path

    def test_chrome_first_then_edge_then_the_default_browser(self):
        with tempfile.TemporaryDirectory() as a,tempfile.TemporaryDirectory() as b:
            env = {'PROGRAMFILES':a,'LOCALAPPDATA':b}
            self.assertIsNone(wishlist_app.find_browser(env))
            edge = self.install(a,'Microsoft','Edge','msedge.exe')
            self.assertEqual(wishlist_app.find_browser(env),edge)
            chrome = self.install(b,'Google','Chrome','chrome.exe')
            self.assertEqual(wishlist_app.find_browser(env),chrome,'Chrome installed for this user only counts too')

    def test_app_window_with_the_everyday_profile(self):
        command = wishlist_app.window_command(Path('C:/chrome.exe'))
        self.assertEqual(command[1],'--app='+wishlist_app.URL)
        self.assertFalse(any(arg.startswith('--user-data-dir') for arg in command),'same localStorage as the browser')

    def test_a_second_copy_only_opens_the_page(self):
        with patch.object(wishlist_app,'first_instance',return_value=False),patch.object(wishlist_app,'find_browser',return_value=None),\
             patch('webbrowser.open') as opened:
            wishlist_app.main(['#add=abc'])
            opened.assert_called_once_with(wishlist_app.URL+'#add=abc')
            wishlist_app.main(['--minimized'])
            self.assertEqual(opened.call_count,1,'starting with Windows opens no window')
        self.assertTrue(wishlist_app.launch_command().endswith('--minimized'))
        self.assertTrue(wishlist_app.ICON.is_file())


if __name__=='__main__':
    unittest.main()
