<?php

namespace App\Services;

use App\Models\FoodCategory;
use App\Models\FoodItem;
use App\Support\Tenant;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * Bulk menu upload from a CSV file (one dish per row).
 * Rows with a product number that already exists UPDATE that dish; every other row creates a new dish.
 * Bad rows are skipped and reported with their row number; good rows are imported.
 */
class MenuImporter
{
    public const MAX_ROWS = 500;

    private const ALIASES = [
        'code' => ['product_number', 'product_no', 'number', 'no', 'code', 'sr_no', 'item_no'],
        'name' => ['name', 'product_name', 'dish', 'dish_name', 'item', 'item_name', 'english_name'],
        'name_mr' => ['marathi_name', 'name_mr', 'marathi', 'name_marathi'],
        'category' => ['category', 'category_name'],
        'price' => ['price', 'rate', 'amount', 'mrp'],
        'gst_percent' => ['gst_percent', 'gst', 'gst_%', 'tax'],
        'discount_percent' => ['discount_percent', 'discount', 'discount_%'],
        'is_veg' => ['veg', 'is_veg', 'type', 'veg_nonveg'],
        'is_available' => ['available', 'is_available', 'active'],
        'stock' => ['stock', 'quantity', 'qty'],
        'description' => ['description', 'details'],
        'offer_text' => ['offer', 'offer_text', 'special_offer'],
    ];

    /** @return array{created:int,updated:int,skipped:int,errors:array<int,array{row:int,message:string}>} */
    public function import(UploadedFile $file): array
    {
        $rows = $this->read($file);
        if (count($rows) > self::MAX_ROWS) {
            abort(422, 'A CSV can have at most '.self::MAX_ROWS.' dishes. Split the file and upload it in parts.');
        }

        $result = ['created' => 0, 'updated' => 0, 'skipped' => 0, 'errors' => []];
        $gstOn = (bool) Tenant::company()->gst_enabled;
        $seenCodes = [];

        DB::transaction(function () use ($rows, &$result, $gstOn, &$seenCodes) {
            foreach ($rows as $line => $r) {
                try {
                    $this->row($r, $gstOn, $seenCodes, $result);
                } catch (\InvalidArgumentException $e) {
                    $result['skipped']++;
                    $result['errors'][] = ['row' => $line, 'message' => $e->getMessage()];
                }
            }
        });

        return $result;
    }

    private function row(array $r, bool $gstOn, array &$seenCodes, array &$result): void
    {
        $name = trim((string) ($r['name'] ?? ''));
        if ($name === '') {
            throw new \InvalidArgumentException('Name is empty.');
        }
        if (mb_strlen($name) > 120) {
            throw new \InvalidArgumentException('Name is longer than 120 characters.');
        }
        $price = $this->number($r['price'] ?? null, 'Price');
        if ($price === null) {
            throw new \InvalidArgumentException('Price is empty.');
        }

        $code = null;
        if (($r['code'] ?? '') !== '') {
            if (! ctype_digit(trim($r['code'])) || (int) $r['code'] < 1 || (int) $r['code'] > 99999) {
                throw new \InvalidArgumentException('Product number must be a whole number from 1 to 99999.');
            }
            $code = (int) $r['code'];
            if (isset($seenCodes[$code])) {
                throw new \InvalidArgumentException("Product number $code is used twice in this file.");
            }
            $seenCodes[$code] = true;
        }

        $catName = trim((string) ($r['category'] ?? ''));
        if ($catName === '') {
            throw new \InvalidArgumentException('Category is empty.');
        }
        $gst = $gstOn ? $this->number($r['gst_percent'] ?? null, 'GST %') : null;
        $discount = $this->number($r['discount_percent'] ?? null, 'Discount %');
        $stock = $this->number($r['stock'] ?? null, 'Stock');
        foreach ([['GST %', $gst, 28], ['Discount %', $discount, 100]] as [$label, $v, $max]) {
            if ($v !== null && ($v < 0 || $v > $max)) {
                throw new \InvalidArgumentException("$label must be between 0 and $max.");
            }
        }
        if ($price < 0 || ($stock !== null && $stock < 0)) {
            throw new \InvalidArgumentException('Price and stock cannot be negative.');
        }

        $category = $this->category($catName);
        $data = array_filter([
            'category_id' => $category->id,
            'name' => $name,
            'name_mr' => $this->text($r['name_mr'] ?? null, 120),
            'description' => $this->text($r['description'] ?? null, 500),
            'offer_text' => $this->text($r['offer_text'] ?? null, 120),
            'price' => $price,
            'gst_percent' => $gst,
            'discount_percent' => $discount,
            'stock' => $stock !== null ? (int) $stock : null,
        ], fn ($v) => $v !== null);
        if (($r['is_veg'] ?? '') !== '') {
            $data['is_veg'] = $this->yes($r['is_veg'], ['no', 'n', '0', 'false', 'non-veg', 'nonveg', 'non veg', 'non_veg']);
        }
        if (($r['is_available'] ?? '') !== '') {
            $data['is_available'] = $this->yes($r['is_available'], ['no', 'n', '0', 'false', 'hidden', 'hide']);
        }

        $existing = $code ? FoodItem::where('code', $code)->first() : null;
        if ($existing) {
            $existing->update($data);
            $result['updated']++;

            return;
        }
        if ($code) {
            $data['code'] = $code;
        }
        FoodItem::create($data);
        $result['created']++;
    }

    private array $categories = [];

    private function category(string $name): FoodCategory
    {
        $key = mb_strtolower($name);
        if (isset($this->categories[$key])) {
            return $this->categories[$key];
        }
        $cat = FoodCategory::whereRaw('LOWER(name) = ?', [$key])->first()
            ?? FoodCategory::create(['name' => mb_substr($name, 0, 80), 'sort_order' => ((int) FoodCategory::max('sort_order')) + 1, 'is_active' => true]);

        return $this->categories[$key] = $cat;
    }

    private function number($v, string $label): ?float
    {
        $v = trim((string) $v);
        if ($v === '') {
            return null;
        }
        $v = str_replace([',', '₹', 'Rs.', 'Rs', '%'], '', $v);
        if (! is_numeric($v)) {
            throw new \InvalidArgumentException("$label \"$v\" is not a number.");
        }

        return (float) $v;
    }

    private function text($v, int $max): ?string
    {
        $v = trim((string) $v);

        return $v === '' ? null : mb_substr($v, 0, $max);
    }

    private function yes($v, array $no): bool
    {
        return ! in_array(mb_strtolower(trim((string) $v)), $no, true);
    }

    /** Reads the CSV into [lineNumber => [field => value]]. Handles UTF-8 BOM and , ; or tab separators. */
    private function read(UploadedFile $file): array
    {
        $text = file_get_contents($file->getRealPath());
        if (str_starts_with($text, "\xEF\xBB\xBF")) {
            $text = substr($text, 3);
        } elseif (str_starts_with($text, "\xFF\xFE") || str_starts_with($text, "\xFE\xFF")) {
            $text = mb_convert_encoding($text, 'UTF-8', 'UTF-16');
        }
        if (! mb_check_encoding($text, 'UTF-8')) {
            $text = mb_convert_encoding($text, 'UTF-8', 'Windows-1252');
        }

        $first = strtok($text, "\n") ?: '';
        $sep = collect([',', ';', "\t"])->sortByDesc(fn ($c) => substr_count($first, $c))->first();

        $fh = fopen('php://temp', 'r+');
        fwrite($fh, $text);
        rewind($fh);

        $header = null;
        $map = [];
        $rows = [];
        $line = 0;
        while (($cells = fgetcsv($fh, 0, $sep, '"', '\\')) !== false) {
            $line++;
            if ($cells === [null] || count(array_filter($cells, fn ($c) => trim((string) $c) !== '')) === 0) {
                continue;
            }
            if ($header === null) {
                $header = array_map(fn ($h) => preg_replace('/[\s\-]+/u', '_', mb_strtolower(trim((string) $h))), $cells);
                foreach ($header as $i => $h) {
                    foreach (self::ALIASES as $field => $names) {
                        if (in_array($h, $names, true) && ! in_array($field, $map, true)) {
                            $map[$i] = $field;
                        }
                    }
                }
                if (! in_array('name', $map, true) || ! in_array('price', $map, true) || ! in_array('category', $map, true)) {
                    abort(422, 'The first row must be the column names. Required columns: name, category, price. Download the sample CSV to see the format.');
                }

                continue;
            }
            $row = [];
            foreach ($map as $i => $field) {
                $row[$field] = $cells[$i] ?? '';
            }
            $rows[$line] = $row;
        }
        fclose($fh);
        abort_if($header === null || ! $rows, 422, 'The file has no dishes. Download the sample CSV and fill it in.');

        return $rows;
    }
}
