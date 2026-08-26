<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('meet_reservations')) {
            return;
        }

        $this->wgw()->create('meet_reservations', function (Blueprint $table): void {
            $table->string('id', 64)->primary();
            $table->string('owner_principal', 190);
            $table->string('created_by', 190);
            $table->timestamp('expires_at')->nullable();
            $table->timestamp('activated_at')->nullable();
            $table->timestamps();

            $table->index('expires_at');
            $table->index(['activated_at', 'expires_at'], 'idx_meet_reservations_sweep');
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('meet_reservations');
    }
};
