import json
import tempfile
import unittest
from unittest.mock import patch

from collectionkit.hub import Hub, HubError, Offline
from collectionkit.testing import FakeHub


class HubTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.fake = FakeHub()
        self.patch = patch('collectionkit.hub.fetch',side_effect=self.fake)
        self.patch.start()
        self.hub = Hub('shuyu',self.temp.name)

    def tearDown(self):
        self.patch.stop()
        self.temp.cleanup()

    def test_pairing_checks_the_code_and_keeps_it_protected_per_app(self):
        self.assertFalse(self.hub.paired)
        with self.assertRaises(HubError):self.hub.pair('不是配对码')
        with self.assertRaises(HubError) as caught:self.hub.pair('mch_unknown')
        self.assertTrue(caught.exception.revoked)
        self.assertFalse(self.hub.paired)
        token = self.fake.token('shuyu')
        self.assertTrue(self.hub.pair(token)['paired'])
        self.assertNotIn(token,(self.hub.folder/'hub.json').read_text(encoding='utf-8'),'kept protected')
        plexus = Hub('plexus',self.temp.name)
        self.assertFalse(plexus.paired,'each app pairs on its own')
        plexus.pair(self.fake.token('plexus'))
        self.assertTrue(Hub('shuyu',self.temp.name).paired,'pairing Plexus leaves 书屿 paired')
        self.assertEqual(set(json.loads((self.hub.folder/'hub.json').read_text(encoding='utf-8'))),{'shuyu','plexus'})
        self.hub.unpair()
        self.assertFalse(self.hub.paired);self.assertTrue(plexus.paired)

    def test_wishes_come_by_category_since_the_last_cursor(self):
        self.hub.pair(self.fake.token('shuyu'))
        self.fake.add({'id':'n1','category':'novel','title':'书','updatedAt':'2026-01-01T00:00:00Z'})
        self.fake.add({'id':'m1','category':'movie','title':'片','updatedAt':'2026-01-01T00:00:00Z'})
        first = self.hub.wishes(['novel'])
        self.assertEqual([i['id'] for i in first['items']],['n1'])
        self.assertEqual(self.hub.wishes(['novel','movie'])['items'][0]['id'],'n1','only its own categories')
        self.assertEqual(self.hub.api_version(),1)

    def test_what_is_sent_while_offline_waits_and_goes_out_later(self):
        self.hub.pair(self.fake.token('shuyu'))
        self.fake.offline = True
        self.assertIsNone(self.hub.put_wish({'id':'n2','category':'novel','title':'离线加的','updatedAt':'2026-02-01T00:00:00Z'}))
        self.hub.fulfill([{'itemId':'n2','ref':'b1','ownedAt':'2026-02-01T00:00:00Z'}])
        self.assertEqual(self.hub.status()['queued'],2)
        with self.assertRaises(Offline):self.hub.wishes(['novel'])
        self.fake.offline = False
        self.hub.flush()
        self.assertEqual(self.hub.status()['queued'],0)
        self.assertIn('n2',self.fake.items);self.assertEqual(self.fake.fulfilled[('n2','shuyu')]['ref'],'b1')
        self.assertEqual([c[0] for c in self.fake.calls[-2:]],['mc_wish_put','mc_fulfill_put'],'in the order they were made')

    def test_a_revoked_pairing_is_reported_and_keeps_the_queue(self):
        token = self.fake.token('shuyu')
        self.hub.pair(token)
        self.fake.revoked.add(token)
        self.hub.fulfill([{'itemId':'n1','ref':'b1','ownedAt':'2026-02-01T00:00:00Z'}])
        self.assertEqual(self.hub.status()['queued'],1)
        self.assertIn('吊销',self.hub.status()['error'])
        with self.assertRaises(HubError) as caught:self.hub.wishes()
        self.assertTrue(caught.exception.revoked)


if __name__=='__main__':
    unittest.main()
