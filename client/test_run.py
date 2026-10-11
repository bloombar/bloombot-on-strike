import unittest

import run


class WithAutostartTest(unittest.TestCase):
    def test_adds_to_url_without_query(self):
        self.assertEqual(run.with_autostart("https://a.example/app/"), "https://a.example/app/?autostart=1")

    def test_preserves_existing_params_and_uses_ampersand(self):
        url = run.with_autostart("https://a.example/?wss=wss://h.example:8001&course=Software+Engineering")
        self.assertEqual(
            url, "https://a.example/?wss=wss://h.example:8001&course=Software+Engineering&autostart=1"
        )

    def test_does_not_override_existing_autostart(self):
        url = run.with_autostart("https://a.example/?autostart=0&wss=x", "9")
        self.assertIn("autostart=0", url)
        self.assertNotIn("autostart=1", url)

    def test_adds_delay_only_when_given_and_absent(self):
        self.assertIn("autostart_delay=5", run.with_autostart("https://a.example/", "5"))
        self.assertNotIn("autostart_delay", run.with_autostart("https://a.example/", None))
        self.assertNotIn("autostart_delay", run.with_autostart("https://a.example/", ""))
        kept = run.with_autostart("https://a.example/?autostart_delay=2", "5")
        self.assertIn("autostart_delay=2", kept)
        self.assertNotIn("autostart_delay=5", kept)

    def test_preserves_fragment(self):
        self.assertEqual(run.with_autostart("https://a.example/?x=1#top"), "https://a.example/?x=1&autostart=1#top")


class MaskTest(unittest.TestCase):
    def test_mask_shows_only_last_four(self):
        self.assertEqual(run.mask("abcdef123456"), "****3456")
        self.assertEqual(run.mask(None), "None")

    def test_mask_hides_short_secrets_entirely(self):
        self.assertEqual(run.mask("abc"), "****")
        self.assertEqual(run.mask("12345678"), "****")
        self.assertEqual(run.mask("123456789"), "****6789")


if __name__ == "__main__":
    unittest.main()
