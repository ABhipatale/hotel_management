<?php

namespace App\Support;

use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * "Business time": the hotel's own clock (India, Asia/Kolkata) for deciding what TODAY is.
 *
 * Timestamps stay stored in UTC (as always, so no existing data moves). What changes is how a DAY is cut: bill / order / KOT numbers
 * restart at midnight in India, "today" in the dashboard and reports means today in India, and a date range such as 16 Nov means
 * 00:00 to 23:59 Indian time, not UTC.
 */
class BizTime
{
    public static function tz(): string
    {
        return (string) config('hms.timezone', 'Asia/Kolkata');
    }

    /** Right now on the hotel's clock. */
    public static function now(): Carbon
    {
        return Carbon::now(self::tz());
    }

    /** Today's date on the hotel's clock, Y-m-d. */
    public static function today(): string
    {
        return self::now()->toDateString();
    }

    /** The UTC moment a business day begins (what the database compares against). `$date` = 'Y-m-d' on the hotel's clock. */
    public static function dayStart(string|Carbon $date): Carbon
    {
        return self::local($date)->startOfDay()->utc();
    }

    public static function dayEnd(string|Carbon $date): Carbon
    {
        return self::local($date)->endOfDay()->utc();
    }

    public static function monthStart(): Carbon
    {
        return self::now()->startOfMonth()->utc();
    }

    /** The calendar date (Y-m-d, hotel's clock) of a stored UTC moment: for the date-only columns such as expense_date. */
    public static function dateOf(Carbon $utc): string
    {
        return $utc->copy()->setTimezone(self::tz())->toDateString();
    }

    /** SQL that turns a stored UTC timestamp column into the hotel's calendar date (for GROUP BY day). */
    public static function dateSql(string $column): string
    {
        $mins = (int) (self::now()->utcOffset());

        return DB::connection()->getDriverName() === 'sqlite'
            ? sprintf("DATE(%s, '%+d minutes')", $column, $mins)
            : sprintf("DATE(CONVERT_TZ(%s, '+00:00', '%s'))", $column, sprintf('%s%02d:%02d', $mins < 0 ? '-' : '+', intdiv(abs($mins), 60), abs($mins) % 60));
    }

    private static function local(string|Carbon $date): Carbon
    {
        return $date instanceof Carbon ? $date->copy()->setTimezone(self::tz()) : Carbon::parse($date, self::tz());
    }
}
