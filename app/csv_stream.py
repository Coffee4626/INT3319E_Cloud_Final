"""CSV preparation with bounded memory; large bodies stay on disk, never in API JSON."""
import csv
import hashlib
import json
from pathlib import Path

from app.datasets import MAX_BYTES, missing, numeric

UNIQUE_LIMIT = 2048


def rows(path):
    if Path(path).stat().st_size > MAX_BYTES:
        raise ValueError('CSV limit: 200 MB')
    try:
        with open(path, encoding='utf-8-sig', newline='') as source:
            reader = csv.reader(source, strict=True)
            columns = next(reader, [])
            if not 2 <= len(columns) <= 200 or len(set(columns)) != len(columns) or any(not c.strip() or len(c) > 128 for c in columns):
                raise ValueError('CSV needs 2–200 unique, non-empty column headers')
            yield columns
            count = 0
            for row in reader:
                if not row:
                    continue
                count += 1
                if count > 100_000:
                    raise ValueError('CSV limit: 100,000 rows')
                if len(row) != len(columns):
                    raise ValueError(f'Row {count + 1} does not match header width')
                yield row
            if count < 2:
                raise ValueError('CSV needs at least two data rows')
    except (UnicodeError, csv.Error) as exc:
        raise ValueError(f'Invalid UTF-8 CSV: {exc}') from exc


def signature(row):
    return hashlib.sha256(json.dumps(row, ensure_ascii=False, separators=(',', ':')).encode()).digest()


class Profiler:
    def __init__(self, columns):
        self.columns = columns
        self.stats = [dict(name=c, type='numeric', missing=0, unique=0, examples=[]) for c in columns]
        self.values = [set() for _ in columns]
        self.seen = set()
        self.preview = []
        self.count = 0

    def add(self, row):
        self.count += 1
        self.seen.add(signature(row))
        if len(self.preview) < 5:
            self.preview.append(dict(zip(self.columns, [v[:64] for v in row])))
        for value, stat, seen in zip(row, self.stats, self.values):
            if missing(value):
                stat['missing'] += 1
                continue
            if stat['type'] == 'numeric' and not numeric(value):
                stat['type'] = 'categorical'
            digest = hashlib.sha256(value.encode()).digest()
            if digest not in seen:
                if len(seen) < UNIQUE_LIMIT:
                    seen.add(digest)
                    if len(stat['examples']) < 3:
                        stat['examples'].append(value[:64])
                else:
                    stat['unique_lower_bound'] = True
            stat['unique'] = len(seen)

    def result(self, size):
        for stat in self.stats:
            if stat['missing'] == self.count:
                stat['type'] = 'categorical'
        return dict(rows=self.count, columns=self.stats, missing_cells=sum(s['missing'] for s in self.stats),
                    duplicates=self.count - len(self.seen), preview=self.preview, size_bytes=size)


def profile_file(path):
    data = rows(path)
    profiler = Profiler(next(data))
    for row in data:
        profiler.add(row)
    return profiler.result(Path(path).stat().st_size)


def prepare_file(source, destination, options):
    data = rows(source)
    columns = next(data)
    target = options.get('target')
    drops = options.get('drop_columns', [])
    if target not in columns:
        raise ValueError('Choose a target column')
    if not isinstance(drops, list) or any(not isinstance(c, str) or c not in columns for c in drops):
        raise ValueError('drop_columns must contain existing column names')
    if target in drops or len(set(columns) - set(drops)) < 2:
        raise ValueError('Keep the target and at least one feature')
    for key in ('trim_strings', 'drop_duplicates', 'drop_missing_target'):
        if key in options and type(options[key]) is not bool:
            raise ValueError(f'{key} must be a boolean')
    keep = [i for i, c in enumerate(columns) if c not in drops]
    out_columns = [columns[i] for i in keep]
    target_index = out_columns.index(target)
    profiler = Profiler(out_columns)
    report = dict(input_rows=0, output_rows=0, dropped_columns=drops)
    seen = set()
    with open(destination, 'w', encoding='utf-8', newline='') as output:
        writer = csv.writer(output, lineterminator='\n')
        writer.writerow(out_columns)
        for original in data:
            report['input_rows'] += 1
            row = [original[i].strip() if options.get('trim_strings', True) else original[i] for i in keep]
            row = ['' if missing(v) else v for v in row]
            if not row[target_index] and options.get('drop_missing_target', True):
                report['removed_missing_target'] = report.get('removed_missing_target', 0) + 1
                continue
            key = signature(row)
            if options.get('drop_duplicates', True):
                if key in seen:
                    report['removed_duplicates'] = report.get('removed_duplicates', 0) + 1
                    continue
                seen.add(key)
            writer.writerow(row)
            profiler.add(row)
            if output.tell() > MAX_BYTES:
                raise ValueError('Prepared CSV exceeds 200 MB')
        if profiler.count < 2:
            raise ValueError('Preprocessing leaves fewer than two rows')
    report['output_rows'] = profiler.count
    return report, profiler.result(Path(destination).stat().st_size)
