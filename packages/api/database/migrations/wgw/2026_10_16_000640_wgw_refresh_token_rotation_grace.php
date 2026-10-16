<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Expand phase. rotated_at, successor_hash, successor_token, and family_id
 * are nullable so existing rows stay valid. Each existing row is its own
 * family: chains were not recorded before this column existed.
 *
 * successor_token is an APP_KEY ciphertext of the successor, kept only so a
 * lost rotation response can be replayed. down() drops that copy. The hash
 * row remains the credential, so there is no plaintext column to restore.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('api_refresh_tokens')) {
            return;
        }

        if (! $this->wgwHasColumn('api_refresh_tokens', 'family_id')) {
            $this->wgw()->table('api_refresh_tokens', function (Blueprint $table): void {
                $table->string('family_id', 26)->nullable();
                $table->unsignedBigInteger('rotated_at')->nullable();
                $table->string('successor_hash', 128)->nullable();
                $table->text('successor_token')->nullable();
            });
            $this->wgw()->table('api_refresh_tokens', function (Blueprint $table): void {
                $table->index('family_id', 'idx_api_refresh_family');
            });
        }

        $this->backfillFamilyIds();
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('api_refresh_tokens') || ! $this->wgwHasColumn('api_refresh_tokens', 'family_id')) {
            return;
        }

        if ($this->hasIndex('api_refresh_tokens', 'idx_api_refresh_family')) {
            $this->wgw()->table('api_refresh_tokens', function (Blueprint $table): void {
                $table->dropIndex('idx_api_refresh_family');
            });
        }

        $this->wgw()->table('api_refresh_tokens', function (Blueprint $table): void {
            $table->dropColumn(['family_id', 'rotated_at', 'successor_hash', 'successor_token']);
        });
    }

    private function backfillFamilyIds(): void
    {
        $hashes = DB::connection('wgw')
            ->table('api_refresh_tokens')
            ->whereNull('family_id')
            ->orderBy('token_hash')
            ->pluck('token_hash');

        foreach ($hashes->chunk(100) as $chunk) {
            $this->assignFamilyIds(array_values($chunk->all()));
        }
    }

    /**
     * @param  list<mixed>  $hashes
     */
    private function assignFamilyIds(array $hashes): void
    {
        $when = [];
        $bindings = [];
        $selected = [];
        foreach ($hashes as $hash) {
            if (! is_string($hash) || $hash === '') {
                continue;
            }
            $when[] = 'WHEN ? THEN ?';
            $bindings[] = $hash;
            $bindings[] = (string) Str::ulid();
            $selected[] = $hash;
        }
        if ($selected === []) {
            return;
        }

        $placeholders = implode(', ', array_fill(0, count($selected), '?'));
        DB::connection('wgw')->update(
            'UPDATE api_refresh_tokens SET family_id = CASE token_hash '.implode(' ', $when).' END WHERE token_hash IN ('.$placeholders.')',
            [...$bindings, ...$selected],
        );
    }

    private function hasIndex(string $table, string $name): bool
    {
        foreach ($this->wgw()->getIndexes($table) as $index) {
            if ($index['name'] === $name) {
                return true;
            }
        }

        return false;
    }
};
