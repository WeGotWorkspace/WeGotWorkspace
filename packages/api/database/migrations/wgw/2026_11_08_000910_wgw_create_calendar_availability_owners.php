<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Team availability master switch (#1908). One row per person who ever set
 * it; no row means off. `updated_at` feeds the person's settings stamp.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('calendar_availability_owners')) {
            return;
        }

        $this->wgw()->create('calendar_availability_owners', function (Blueprint $table): void {
            $table->string('principal_uri', 255)->primary();
            $table->boolean('enabled')->default(false);
            $table->timestamp('updated_at', 6);
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('calendar_availability_owners');
    }
};
