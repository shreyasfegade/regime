"""
REGIME — Universe
The stocks REGIME covers: the constituents of the NIFTY 50 (NSE's official
list, config.UNIVERSE_MEMBERS_URL), with each company's rank and large/mid/
small band taken from AMFI's half-yearly market-cap classification list (the
list SEBI uses to define the bands), plus the indices in config.

Sectors come from NSE's index constituent lists (the Industry column, keyed
by ISIN). Any company outside those lists is classified from Yahoo Finance's
sector and industry, mapped onto the same NSE taxonomy, and marked as such.
"""

import csv
import io
import re
from datetime import date

from regime.config import AMFI_URL, CAP_BANDS, UNIVERSE_SIZE

UNIVERSE_FIELDS: list[str] = [
    'rank', 'slug', 'name', 'isin', 'nse', 'bse', 'cap', 'sector', 'sector_source', 'list_date',
]

# Yahoo industry keywords → NSE industry, checked in order (most specific
# first). Anything unmatched falls back to YAHOO_SECTOR_MAP.
YAHOO_INDUSTRY_MAP: list[tuple[str, str]] = [
    ('auto', 'Automobile and Auto Components'),
    ('recreational vehicles', 'Automobile and Auto Components'),
    ('textile', 'Textiles'),
    ('apparel manufacturing', 'Textiles'),
    ('steel', 'Metals & Mining'),
    ('aluminum', 'Metals & Mining'),
    ('copper', 'Metals & Mining'),
    ('metal', 'Metals & Mining'),
    ('mining', 'Metals & Mining'),
    ('gold', 'Metals & Mining'),
    ('silver', 'Metals & Mining'),
    ('building materials', 'Construction Materials'),
    ('engineering & construction', 'Construction'),
    ('infrastructure operations', 'Construction'),
    ('real estate', 'Realty'),
    ('regulated gas', 'Utilities'),
    ('regulated water', 'Utilities'),
    ('electric', 'Power'),
    ('renewable', 'Power'),
    ('independent power', 'Power'),
    ('entertainment', 'Media Entertainment & Publication'),
    ('broadcasting', 'Media Entertainment & Publication'),
    ('publishing', 'Media Entertainment & Publication'),
    ('advertising', 'Media Entertainment & Publication'),
    ('telecom', 'Telecommunication'),
    ('oil', 'Oil Gas & Consumable Fuels'),
    ('gas', 'Oil Gas & Consumable Fuels'),
    ('coal', 'Oil Gas & Consumable Fuels'),
    ('furnishings', 'Consumer Durables'),
    ('appliances', 'Consumer Durables'),
    ('consumer electronics', 'Consumer Durables'),
    ('footwear', 'Consumer Durables'),
    ('luxury goods', 'Consumer Durables'),
    ('packaged foods', 'Fast Moving Consumer Goods'),
    ('beverages', 'Fast Moving Consumer Goods'),
    ('tobacco', 'Fast Moving Consumer Goods'),
    ('household & personal', 'Fast Moving Consumer Goods'),
    ('confectioners', 'Fast Moving Consumer Goods'),
    ('farm products', 'Fast Moving Consumer Goods'),
    ('chemicals', 'Chemicals'),
    ('agricultural inputs', 'Chemicals'),
    ('paper', 'Forest Materials'),
    ('lumber', 'Forest Materials'),
    ('drug', 'Healthcare'),
    ('medical', 'Healthcare'),
    ('biotech', 'Healthcare'),
    ('diagnostics', 'Healthcare'),
    ('health', 'Healthcare'),
    ('staffing', 'Services'),
    ('consulting', 'Services'),
    ('specialty business services', 'Services'),
    ('security & protection', 'Services'),
    ('rental', 'Services'),
    ('waste', 'Services'),
    ('airlines', 'Services'),
    ('airports', 'Services'),
    ('marine shipping', 'Services'),
    ('railroads', 'Services'),
    ('trucking', 'Services'),
    ('freight', 'Services'),
    ('software', 'Information Technology'),
    ('information technology', 'Information Technology'),
    ('computer', 'Information Technology'),
    ('bank', 'Financial Services'),
    ('insurance', 'Financial Services'),
    ('capital markets', 'Financial Services'),
    ('credit services', 'Financial Services'),
    ('asset management', 'Financial Services'),
    ('financial', 'Financial Services'),
    ('mortgage', 'Financial Services'),
    ('conglomerates', 'Diversified'),
    ('retail', 'Consumer Services'),
    ('restaurants', 'Consumer Services'),
    ('lodging', 'Consumer Services'),
    ('travel', 'Consumer Services'),
    ('leisure', 'Consumer Services'),
    ('resorts', 'Consumer Services'),
    ('education', 'Consumer Services'),
]
YAHOO_SECTOR_MAP: dict[str, str] = {
    'Technology': 'Information Technology',
    'Financial Services': 'Financial Services',
    'Healthcare': 'Healthcare',
    'Consumer Defensive': 'Fast Moving Consumer Goods',
    'Consumer Cyclical': 'Consumer Services',
    'Industrials': 'Capital Goods',
    'Basic Materials': 'Chemicals',
    'Energy': 'Oil Gas & Consumable Fuels',
    'Utilities': 'Power',
    'Real Estate': 'Realty',
    'Communication Services': 'Telecommunication',
}
UNCLASSIFIED: str = 'Unclassified'


def half_year_stamps(today: date, n: int = 4) -> list[str]:
    """AMFI list stamps ('31Dec2025', '30Jun2025', …), newest first, not after today."""
    out = []
    y = today.year
    candidates = []
    for year in range(y, y - 4, -1):
        candidates += [date(year, 12, 31), date(year, 6, 30)]
    for d in sorted((c for c in candidates if c <= today), reverse=True)[:n]:
        out.append(d.strftime('%d%b%Y'))
    return out


def stamp_to_iso(stamp: str) -> str:
    from datetime import datetime
    return datetime.strptime(stamp, '%d%b%Y').date().isoformat()


def fetch_latest_amfi(get, today: date | None = None) -> tuple[str, bytes]:
    """
    Download the newest AMFI list. `get(url)` returns (status, bytes).
    AMFI publishes in early January and July; until a half-year's list is
    up, its URL 404s and the previous one is used.
    """
    today = today or date.today()
    for stamp in half_year_stamps(today):
        status, body = get(AMFI_URL.format(stamp=stamp))
        if status == 200 and body[:2] == b'PK':  # an .xlsx is a zip archive
            return stamp, body
    raise RuntimeError('No AMFI market-cap list found for the last two years.')


def parse_amfi(xlsx: bytes, n: int = UNIVERSE_SIZE) -> list[dict]:
    """Top-n companies from an AMFI average-market-cap workbook."""
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(xlsx), read_only=True, data_only=True)
    ws = wb.worksheets[0]
    header, rows = None, []
    for row in ws.iter_rows(values_only=True):
        cells = ['' if c is None else str(c).strip() for c in row]
        if header is None:
            if any(c.upper() == 'ISIN' for c in cells):
                header = [c.lower() for c in cells]
            continue
        if not cells or not cells[0].strip():
            continue
        rows.append(dict(zip(header, cells)))
    if header is None:
        raise ValueError('AMFI workbook has no ISIN header row.')

    def col(*keys):
        for i, h in enumerate(header):
            if all(k in h for k in keys):
                return header[i]
        raise ValueError(f'AMFI workbook is missing a column like {keys}')

    c_rank, c_name, c_isin = col('sr'), col('company'), col('isin')
    c_nse, c_bse = col('nse', 'symbol'), col('bse', 'symbol')
    c_cat = col('categori')

    out = []
    for r in rows:
        try:
            rank = int(float(r[c_rank]))
        except ValueError:
            continue
        if rank > n:
            continue
        nse = _symbol(r[c_nse])
        bse = _symbol(r[c_bse])
        out.append({
            'rank': rank,
            'name': _tidy_name(r[c_name]),
            'isin': r[c_isin].strip().upper(),
            'nse': nse,
            'bse': bse,
            'cap': CAP_BANDS.get(r[c_cat].strip(), 'S'),
        })
    out.sort(key=lambda d: d['rank'])
    return out


def parse_industry_csv(text: str) -> dict[str, str]:
    """{ISIN: Industry} from an NSE index constituent CSV."""
    reader = csv.DictReader(io.StringIO(text.lstrip('﻿')))
    out = {}
    for row in reader:
        isin = (row.get('ISIN Code') or '').strip().upper()
        industry = (row.get('Industry') or '').strip()
        if isin and industry:
            out[isin] = industry
    return out


def map_yahoo_sector(sector: str | None, industry: str | None) -> str | None:
    """Map Yahoo's sector/industry onto the NSE industry taxonomy."""
    ind = (industry or '').lower()
    for key, nse in YAHOO_INDUSTRY_MAP:
        if key in ind:
            return nse
    return YAHOO_SECTOR_MAP.get(sector or '')


def make_slugs(companies: list[dict]) -> None:
    """
    Assign each company a URL- and filename-safe slug, unique in the set.
    NSE symbols take precedence; a BSE-only symbol that collides with one
    gets a -BSE suffix.
    """
    def base(c):
        return re.sub(r'[^A-Z0-9]+', '-', (c['nse'] or c['bse'] or c['isin']).upper()).strip('-')
    seen = {base(c) for c in companies if c['nse']}
    for c in companies:
        slug = base(c)
        if not c['nse'] and slug in seen:
            slug += '-BSE'
        while not c['nse'] and slug in seen:
            slug += '-X'
        seen.add(slug)
        c['slug'] = slug


def build_universe(xlsx: bytes, list_stamp: str, industry_csvs: list[str],
                   yahoo_lookup=None, n: int = UNIVERSE_SIZE,
                   members_csv: str | None = None) -> list[dict]:
    """
    Assemble the universe rows.

    members_csv, an NSE index constituent list, restricts the universe to
    that index's members (matched by ISIN). yahoo_lookup(symbol) →
    (sector, industry) is called only for companies missing from the NSE
    lists; it may raise, in which case the company is left Unclassified.
    """
    companies = parse_amfi(xlsx, n)
    if members_csv is not None:
        # Match by ISIN, falling back to the NSE symbol: an ISIN changes on a
        # split or face-value change, and AMFI's list can lag behind it.
        rows = list(csv.DictReader(io.StringIO(members_csv.lstrip('\ufeff'))))
        by_isin = {r['ISIN Code'].strip().upper(): r for r in rows}
        by_sym = {r['Symbol'].strip().upper(): r for r in rows}
        kept = []
        for c in companies:
            m = by_isin.get(c['isin']) or (by_sym.get(c['nse']) if c['nse'] else None)
            if m:
                c['isin'] = m['ISIN Code'].strip().upper()  # current ISIN, for the sector join
                kept.append(c)
        companies = kept
        industry_csvs = [members_csv, *industry_csvs]
    industries: dict[str, str] = {}
    for text in industry_csvs:
        industries.update(parse_industry_csv(text))
    make_slugs(companies)
    list_date = stamp_to_iso(list_stamp)
    for c in companies:
        c['list_date'] = list_date
        if c['isin'] in industries:
            c['sector'], c['sector_source'] = industries[c['isin']], 'NSE'
            continue
        sector = None
        if yahoo_lookup is not None:
            for sym in yahoo_symbols(c):
                try:
                    sector = map_yahoo_sector(*yahoo_lookup(sym))
                except Exception:  # noqa: BLE001 — try the next exchange
                    sector = None
                if sector:
                    break
        c['sector'] = sector or UNCLASSIFIED
        c['sector_source'] = 'Yahoo' if sector else 'none'
    return companies


def yahoo_symbols(c: dict) -> list[str]:
    """Yahoo symbols to try for a company, NSE first."""
    out = []
    if c.get('nse'):
        out.append(f"{c['nse']}.NS")
    if c.get('bse'):
        out.append(f"{c['bse']}.BO")
    return out


def write_universe(path, rows: list[dict]) -> None:
    with open(path, 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=UNIVERSE_FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, '') for k in UNIVERSE_FIELDS})


def read_universe(path) -> list[dict]:
    with open(path, encoding='utf-8') as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r['rank'] = int(r['rank'])
    return rows


def _symbol(s: str) -> str:
    s = (s or '').strip().upper()
    return '' if s in ('', '-', 'NA', 'N/A') else s


def _tidy_name(s: str) -> str:
    s = re.sub(r'\s+', ' ', s).strip()
    if s.isupper():
        # Shouting names: title-case words, keep short acronyms (ITC, LIC, IST).
        s = ' '.join(w if len(w) <= 3 else w.capitalize() for w in s.split())
    return re.sub(r'\b(LIMITED|LTD)\.?$', 'Ltd', s, flags=re.IGNORECASE)
