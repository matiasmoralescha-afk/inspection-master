import unittest
from agent.normalizers import (
    normalize_unit_id,
    normalize_po,
    normalize_date,
    extract_country_from_shipper,
    extract_shipper_name,
    extract_commodity_from_description,
    normalize_commodity,
)


class TestNormalizeUnitId(unittest.TestCase):
    def test_strips_spaces_and_dashes(self):
        self.assertEqual(normalize_unit_id('SMLU 547697-5'), 'SMLU5476975')

    def test_uppercase(self):
        self.assertEqual(normalize_unit_id('abcd1234567'), 'ABCD1234567')

    def test_tabs(self):
        self.assertEqual(normalize_unit_id('TCKU\t123456 7'), 'TCKU1234567')

    def test_none_input(self):
        self.assertIsNone(normalize_unit_id(None))

    def test_empty_string(self):
        self.assertIsNone(normalize_unit_id(''))

    def test_already_normalized(self):
        self.assertEqual(normalize_unit_id('MSCU1234567'), 'MSCU1234567')


class TestNormalizePo(unittest.TestCase):
    def test_placeholder_returns_none(self):
        self.assertIsNone(normalize_po('PO'))

    def test_na_returns_none(self):
        self.assertIsNone(normalize_po('N/A'))

    def test_valid_po(self):
        self.assertEqual(normalize_po('92026//TAEXPO020'), '92026//TAEXPO020')

    def test_whitespace_stripped(self):
        self.assertEqual(normalize_po('  AV26032  '), 'AV26032')

    def test_none_returns_none(self):
        self.assertIsNone(normalize_po(None))


class TestNormalizeDate(unittest.TestCase):
    def test_mm_dd_yy(self):
        self.assertEqual(normalize_date('06/16/26'), '2026-06-16')

    def test_mm_dd_yyyy(self):
        self.assertEqual(normalize_date('06/16/2026'), '2026-06-16')

    def test_single_digit_month_day(self):
        self.assertEqual(normalize_date('6/3/26'), '2026-06-03')

    def test_already_iso(self):
        self.assertEqual(normalize_date('2026-06-16'), '2026-06-16')

    def test_none(self):
        self.assertIsNone(normalize_date(None))

    def test_empty(self):
        self.assertIsNone(normalize_date(''))


class TestShipperParsing(unittest.TestCase):
    def test_extract_country(self):
        self.assertEqual(extract_country_from_shipper('TA EXPORT(PERU)'), 'PERU')

    def test_extract_country_with_spaces(self):
        self.assertEqual(extract_country_from_shipper('GROWER NAME (CHILE)'), 'CHILE')

    def test_no_country(self):
        self.assertIsNone(extract_country_from_shipper('PLAIN SHIPPER'))

    def test_none_input(self):
        self.assertIsNone(extract_country_from_shipper(None))

    def test_extract_name(self):
        self.assertEqual(extract_shipper_name('TA EXPORT(PERU)'), 'TA EXPORT')

    def test_extract_name_preserves_rest(self):
        self.assertEqual(extract_shipper_name('KIMSA FRESH SAC(PERU)'), 'KIMSA FRESH SAC')


class TestCommodityExtraction(unittest.TestCase):
    def test_asparagus(self):
        self.assertEqual(extract_commodity_from_description('2500 BOXES OF ASPARAGUS'), 'Asparagus')

    def test_brussels_sprouts(self):
        self.assertEqual(
            extract_commodity_from_description('1800 BOXES OF BRUSSELS SPROUTS'),
            'Brussels Sprouts',
        )

    def test_case_insensitive(self):
        self.assertEqual(extract_commodity_from_description('500 boxes of asparagus'), 'Asparagus')

    def test_cartons(self):
        self.assertEqual(extract_commodity_from_description('300 CARTONS OF LIMES'), 'Limes')

    def test_none_input(self):
        self.assertIsNone(extract_commodity_from_description(None))

    def test_normalize_synonym(self):
        self.assertEqual(normalize_commodity('Asparagus-General'), 'Asparagus')
        self.assertEqual(normalize_commodity('Apple'), 'Apples')


if __name__ == '__main__':
    unittest.main()
