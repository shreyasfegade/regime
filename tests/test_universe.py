import io
from datetime import date

import openpyxl
import pytest

from regime.universe import (
    build_universe, fetch_latest_amfi, half_year_stamps, make_slugs, map_yahoo_sector,
    parse_amfi, parse_industry_csv,
)

HEADER = ['Sr. No.', 'Company name', 'ISIN', 'BSE Symbol', 'BSE 6 month Avg Total Market Cap in (Rs. Crs.)',
          'NSE Symbol', 'NSE 6 month Avg Total Market Cap (Rs. Crs.)', 'MSEI Symbol',
          'MSEI 6 month Avg Total Market Cap in (Rs Crs.)', 'Average of All Exchanges (Rs. Cr.)',
          'Categorization as per SEBI Circular dated Oct 6, 2017']


def amfi_xlsx(rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(['Average Market Capitalization of listed companies during the six months ended 31 December 2025'])
    ws.append(HEADER)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


ROWS = [
    [1, 'Reliance Industries Ltd', 'INE002A01018', 'RELIANCE', 1, 'RELIANCE', 1, '-', '-', 1, 'Large Cap'],
    [2, 'Mahindra & Mahindra Ltd', 'INE101A01026', 'M&M', 1, 'M&M', 1, '-', '-', 1, 'Mid Cap'],
    [3, 'FEDDERS HOLDING LIMITED', 'INE417D01020', 'FEDDERSHOL', 1, '-', '-', '-', '-', 1, 'Small Cap'],
    [4, 'Fourth Ltd', 'INE000000004', 'FOURTH', 1, 'FOURTH', 1, '-', '-', 1, 'Small Cap'],
]
INDUSTRY = 'Company Name,Industry,Symbol,Series,ISIN Code\nReliance Industries Ltd.,Oil Gas & Consumable Fuels,RELIANCE,EQ,INE002A01018\n'


def test_half_year_stamps_newest_first():
    assert half_year_stamps(date(2026, 10, 18)) == ['30Jun2026', '31Dec2025', '30Jun2025', '31Dec2024']
    assert half_year_stamps(date(2026, 3, 1))[0] == '31Dec2025'


def test_fetch_latest_falls_back_past_unpublished_lists():
    seen = []

    def get(url):
        seen.append(url)
        return (404, b'') if '30Jun2026' in url else (200, b'PK\x03\x04')
    stamp, body = fetch_latest_amfi(get, date(2026, 10, 18))
    assert stamp == '31Dec2025' and body.startswith(b'PK')
    assert len(seen) == 2


def test_parse_takes_top_n_and_maps_columns():
    rows = parse_amfi(amfi_xlsx(ROWS), n=3)
    assert [r['rank'] for r in rows] == [1, 2, 3]
    assert rows[0]['nse'] == 'RELIANCE' and rows[0]['cap'] == 'L'
    assert rows[1]['cap'] == 'M'
    assert rows[2]['nse'] == '' and rows[2]['bse'] == 'FEDDERSHOL'
    assert rows[2]['name'] == 'Fedders Holding Ltd'


def test_slugs_are_url_safe_and_unique():
    rows = parse_amfi(amfi_xlsx(ROWS))
    make_slugs(rows)
    assert [r['slug'] for r in rows] == ['RELIANCE', 'M-M', 'FEDDERSHOL', 'FOURTH']


def test_sector_join_by_isin_then_yahoo_then_unclassified():
    def lookup(sym):
        if sym == 'M&M.NS':
            return 'Consumer Cyclical', 'Auto Manufacturers'
        raise RuntimeError('not found')
    rows = build_universe(amfi_xlsx(ROWS), '31Dec2025', [INDUSTRY], lookup)
    by = {r['slug']: r for r in rows}
    assert by['RELIANCE']['sector'] == 'Oil Gas & Consumable Fuels'
    assert by['RELIANCE']['sector_source'] == 'NSE'
    assert by['M-M']['sector'] == 'Automobile and Auto Components'
    assert by['M-M']['sector_source'] == 'Yahoo'
    assert by['FOURTH']['sector'] == 'Unclassified'
    assert all(r['list_date'] == '2025-12-31' for r in rows)


@pytest.mark.parametrize('sector,industry,expect', [
    ('Basic Materials', 'Steel', 'Metals & Mining'),
    ('Basic Materials', 'Specialty Chemicals', 'Chemicals'),
    ('Financial Services', 'Banks - Regional', 'Financial Services'),
    ('Technology', 'Something New', 'Information Technology'),
    ('Unknown', 'Unknown', None),
])
def test_yahoo_mapping(sector, industry, expect):
    assert map_yahoo_sector(sector, industry) == expect


def test_industry_csv_handles_bom():
    assert parse_industry_csv('﻿' + INDUSTRY) == {'INE002A01018': 'Oil Gas & Consumable Fuels'}


def test_bse_only_slug_yields_to_an_nse_symbol():
    rows = [{'nse': 'ABC', 'bse': 'ABC', 'isin': 'X1'}, {'nse': '', 'bse': 'ABC', 'isin': 'X2'}]
    make_slugs(rows)
    assert [r['slug'] for r in rows] == ['ABC', 'ABC-BSE']


def test_members_list_restricts_universe_matching_isin_or_symbol():
    # M&M is a member under a new ISIN (as after a split); Reliance by ISIN.
    members = ('Company Name,Industry,Symbol,Series,ISIN Code\n'
               'Reliance Industries Ltd.,Oil Gas & Consumable Fuels,RELIANCE,EQ,INE002A01018\n'
               'Mahindra & Mahindra Ltd.,Automobile and Auto Components,M&M,EQ,INE101A01099\n')
    rows = build_universe(amfi_xlsx(ROWS), '31Dec2025', [], None, members_csv=members)
    assert [r['slug'] for r in rows] == ['RELIANCE', 'M-M']
    assert rows[1]['isin'] == 'INE101A01099'
    assert rows[1]['sector'] == 'Automobile and Auto Components' and rows[1]['rank'] == 2
