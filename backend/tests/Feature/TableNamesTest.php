<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\HotelTable;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Table names with a prefix ("G" + "1" = "G1") and sections. The prefix lives inside the table's number, so every screen shows it. */
class TableNamesTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        Tenant::clear();
    }

    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        $this->app['auth']->forgetGuards();

        return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
    }

    private function login(string $email, string $pw = 'Demo@12345'): array
    {
        return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => $pw])->assertOk()->json('token')];
    }

    private function numbers(array $h): array
    {
        return collect($this->getJson('/api/tables', $h)->json())->pluck('number')->all();
    }

    public function test_a_prefix_builds_the_table_name_and_t_keeps_the_bare_number(): void
    {
        $owner = $this->login('atithi@demo.test');
        $g = $this->postJson('/api/tables', ['prefix' => 'g', 'number' => '1', 'capacity' => 4, 'section' => 'Garden'], $owner)->assertCreated()->json();
        $this->assertSame('G1', $g['number']);                 // saved in upper case
        $this->assertSame('Garden', $g['section']);
        $this->assertSame('table', $g['kind']);

        $t = $this->postJson('/api/tables', ['prefix' => 'T', 'number' => '101', 'capacity' => 4], $owner)->assertCreated()->json();
        $this->assertSame('101', $t['number']);                // "T" = the bare number, as today
        $none = $this->postJson('/api/tables', ['number' => '102', 'capacity' => 4], $owner)->assertCreated()->json();
        $this->assertSame('102', $none['number']);             // an old app sends no prefix: exactly as before
        $this->assertSame('AC1', $this->postJson('/api/tables', ['prefix' => 'AC', 'number' => '1', 'capacity' => 2], $owner)->assertCreated()->json('number'));
        $this->assertSame('G2', $this->postJson('/api/tables', ['prefix' => 'G', 'number' => 'G2', 'capacity' => 2], $owner)->assertCreated()->json('number')); // not doubled ("GG2")
    }

    public function test_g1_and_table_1_can_both_exist_but_not_twice(): void
    {
        $owner = $this->login('atithi@demo.test');
        $this->postJson('/api/tables', ['number' => '901', 'capacity' => 4], $owner)->assertCreated();
        $this->postJson('/api/tables', ['prefix' => 'G', 'number' => '901', 'capacity' => 4], $owner)->assertCreated(); // G901 next to 901
        $this->postJson('/api/tables', ['prefix' => 'G', 'number' => '901', 'capacity' => 4], $owner)->assertStatus(422)->assertJsonFragment(['message' => 'Table G901 already exists.']);
        $this->postJson('/api/tables', ['number' => '901', 'capacity' => 4], $owner)->assertStatus(422); // the plain table is still unique
        $this->assertContains('901', $this->numbers($owner));
        $this->assertContains('G901', $this->numbers($owner));
    }

    public function test_the_prefix_p_or_parcel_is_refused_and_bad_prefixes_too(): void
    {
        $owner = $this->login('atithi@demo.test');
        foreach (['P', 'p', 'PARCEL', 'parcel', 'G1', 'TOOLONGX', 'G-'] as $bad) {
            $this->postJson('/api/tables', ['prefix' => $bad, 'number' => '5', 'capacity' => 4], $owner)->assertStatus(422)->assertJsonValidationErrors('prefix');
        }
        $this->assertNotContains('P5', $this->numbers($owner));
    }

    public function test_parcels_still_work_next_to_tables_and_prefixed_tables(): void
    {
        $owner = $this->login('atithi@demo.test');
        Company::query()->update(['parcel_enabled' => true]);
        $this->postJson('/api/tables', ['number' => '801', 'capacity' => 4], $owner)->assertCreated();
        $this->postJson('/api/tables', ['prefix' => 'G', 'number' => '801', 'capacity' => 4], $owner)->assertCreated();
        // a parcel "1" while a table "1" exists: the table's number must not block it
        $this->postJson('/api/tables', ['number' => '1', 'capacity' => 4], $owner);
        $p = $this->postJson('/api/tables', ['kind' => 'parcel', 'number' => '1', 'capacity' => 1], $owner)->assertCreated()->json();
        $this->assertSame('Parcel 1', $p['number']);
        $this->assertSame('parcel', $p['kind']);
        $this->postJson('/api/tables', ['kind' => 'parcel', 'number' => '1', 'capacity' => 1], $owner)->assertStatus(422); // no second Parcel 1
        // a prefix sent with a parcel is ignored: it stays "Parcel 2"
        $this->assertSame('Parcel 2', $this->postJson('/api/tables', ['kind' => 'parcel', 'prefix' => 'G', 'number' => '2', 'capacity' => 1], $owner)->assertCreated()->json('number'));
    }

    public function test_renaming_keeps_names_unique_without_clashing_with_itself(): void
    {
        $owner = $this->login('atithi@demo.test');
        $g1 = $this->postJson('/api/tables', ['prefix' => 'G', 'number' => '1', 'capacity' => 4], $owner)->assertCreated()->json();
        $g2 = $this->postJson('/api/tables', ['prefix' => 'G', 'number' => '2', 'capacity' => 4], $owner)->assertCreated()->json();

        // saving G1 again with its own name is fine
        $this->putJson('/api/tables/'.$g1['id'], ['prefix' => 'G', 'number' => '1', 'section' => 'Garden'], $owner)->assertOk()->assertJsonPath('number', 'G1')->assertJsonPath('section', 'Garden');
        // moving it onto another table's name is refused
        $this->putJson('/api/tables/'.$g1['id'], ['prefix' => 'G', 'number' => '2'], $owner)->assertStatus(422);
        // a new prefix renames it
        $this->putJson('/api/tables/'.$g2['id'], ['prefix' => 'AC', 'number' => '2'], $owner)->assertOk()->assertJsonPath('number', 'AC2');
        // back to the bare number
        $this->putJson('/api/tables/'.$g2['id'], ['prefix' => 'T', 'number' => '2'], $owner)->assertOk()->assertJsonPath('number', '2');
        // the P prefix is refused on rename too
        $this->putJson('/api/tables/'.$g2['id'], ['prefix' => 'P', 'number' => '2'], $owner)->assertStatus(422);
        // an old app (no prefix) renames and updates the section exactly as before
        $this->putJson('/api/tables/'.$g2['id'], ['number' => '77', 'section' => 'AC hall'], $owner)->assertOk()->assertJsonPath('number', '77');
        $this->assertSame('G1', HotelTable::withoutGlobalScopes()->find($g1['id'])->number);
    }

    public function test_another_company_cannot_see_or_rename_these_tables(): void
    {
        $owner = $this->login('atithi@demo.test');
        $other = $this->login('friends@demo.test');
        $g1 = $this->postJson('/api/tables', ['prefix' => 'G', 'number' => '1', 'capacity' => 4], $owner)->assertCreated()->json();
        $this->assertNotContains('G1', $this->numbers($other));
        $this->putJson('/api/tables/'.$g1['id'], ['prefix' => 'X', 'number' => '1'], $other)->assertNotFound();
        $this->assertSame('G1', HotelTable::withoutGlobalScopes()->find($g1['id'])->number);
        // the other hotel can use the same name for its own table
        $this->postJson('/api/tables', ['prefix' => 'G', 'number' => '1', 'capacity' => 4], $other)->assertCreated();
    }
}
