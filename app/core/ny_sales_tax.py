import re
from dataclasses import asdict, dataclass
from datetime import date, timedelta


MIN_TAX_PERIOD_YEAR = 2000
MAX_TAX_PERIOD_YEAR = 2100
_PERIOD_PATTERN = re.compile(r"^(?P<year>\d{4})-Q(?P<quarter>[1-4])$")
_QUARTER_MONTH_LABELS = {
    1: "Dec-Feb",
    2: "Mar-May",
    3: "Jun-Aug",
    4: "Sep-Nov",
}


@dataclass(frozen=True)
class NYSalesTaxPeriod:
    key: str
    year: int
    quarter: int
    start_date: date
    end_date: date
    label: str
    report_label: str

    def model_dump(self) -> dict[str, str | int]:
        data = asdict(self)
        data["start_date"] = self.start_date.isoformat()
        data["end_date"] = self.end_date.isoformat()
        return data


def ny_sales_tax_period(value: str) -> NYSalesTaxPeriod:
    match = _PERIOD_PATTERN.fullmatch(value or "")
    if match is None:
        raise ValueError("Sales tax period must use YYYY-Q1 through YYYY-Q4")

    year = int(match.group("year"))
    quarter = int(match.group("quarter"))
    if not MIN_TAX_PERIOD_YEAR <= year <= MAX_TAX_PERIOD_YEAR:
        raise ValueError(
            f"Sales tax period year must be between {MIN_TAX_PERIOD_YEAR} and {MAX_TAX_PERIOD_YEAR}"
        )

    if quarter == 1:
        start_date = date(year - 1, 12, 1)
        end_date = date(year, 3, 1) - timedelta(days=1)
    else:
        start_month = 3 + ((quarter - 2) * 3)
        start_date = date(year, start_month, 1)
        next_quarter_month = start_month + 3
        end_date = date(year, next_quarter_month, 1) - timedelta(days=1)

    month_label = _QUARTER_MONTH_LABELS[quarter]
    label = f"Q{quarter} {year} ({month_label})"
    return NYSalesTaxPeriod(
        key=f"{year}-Q{quarter}",
        year=year,
        quarter=quarter,
        start_date=start_date,
        end_date=end_date,
        label=label,
        report_label=f"NY Sales Tax {label}",
    )


def ny_sales_tax_periods(start_year: int, end_year: int) -> list[NYSalesTaxPeriod]:
    bounded_start = max(start_year, MIN_TAX_PERIOD_YEAR)
    bounded_end = min(end_year, MAX_TAX_PERIOD_YEAR)
    if bounded_end < bounded_start:
        return []
    return [
        ny_sales_tax_period(f"{year}-Q{quarter}")
        for year in range(bounded_start, bounded_end + 1)
        for quarter in range(1, 5)
    ]
