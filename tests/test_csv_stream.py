import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from app.csv_stream import profile_file, prepare_file, UNIQUE_LIMIT
from app.datasets import profile, prepare


class CsvStreamTests(unittest.TestCase):
    def test_streaming_matches_small_csv_and_preserves_quoted_values(self):
        text = 'x,description,y\n1,"a, b",yes\n2,"two\nlines",no\n1,"a, b",yes\n3,null,\n'
        with TemporaryDirectory() as folder:
            source, destination = Path(folder)/'in.csv', Path(folder)/'out.csv'
            source.write_text(text)
            self.assertEqual(profile_file(source), profile(text))
            options = {'target': 'y', 'drop_columns': ['description']}
            report, info = prepare_file(source, destination, options)
            expected, expected_report = prepare(text, options)
            self.assertEqual(destination.read_text(), expected)
            self.assertEqual(report, expected_report)
            self.assertEqual(info, profile(expected))

    def test_high_cardinality_is_bounded_and_flagged(self):
        with TemporaryDirectory() as folder:
            source = Path(folder)/'data.csv'
            source.write_text('x,y\n' + ''.join(f'{i},{i%2}\n' for i in range(UNIQUE_LIMIT+10)))
            info = profile_file(source)
            self.assertEqual(info['columns'][0]['unique'], UNIQUE_LIMIT)
            self.assertTrue(info['columns'][0]['unique_lower_bound'])
            self.assertEqual(info['columns'][1]['unique'], 2)
            self.assertEqual(info['duplicates'], 0)

    def test_oversized_and_invalid_files_rejected(self):
        with TemporaryDirectory() as folder:
            source = Path(folder)/'data.csv'
            with source.open('wb') as f: f.truncate(200_000_001)
            with self.assertRaisesRegex(ValueError, '200 MB'): profile_file(source)
            for content in (b'x,x\n1,2\n3,4', b'x,y\n1\n2,3', b'x,y\n\xff,a\n1,b'):
                source.write_bytes(content)
                with self.assertRaises(ValueError): profile_file(source)
