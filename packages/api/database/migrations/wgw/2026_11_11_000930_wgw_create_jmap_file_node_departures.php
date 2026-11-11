<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * FileNode departures (#2036): one row per node whose storage key changed in a
 * move, with the key it left. FileNode/changes reads them to report a node that
 * moved out of the caller's sight as destroyed (RFC 8620 §5.2), e.g. a Team Doc
 * moved to its owner's personal Trash. `seq` is the change sequence of the move.
 * Rows are pruned with the tombstones and raise the same pruning horizon.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('jmap_file_node_departures')) {
            return;
        }

        $this->wgw()->create('jmap_file_node_departures', function (Blueprint $table): void {
            $table->id();
            $table->string('node_id', 64);
            $table->string('from_key', 1024);
            $table->unsignedBigInteger('seq')->index();
            $table->timestamp('created_at')->nullable()->index();
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('jmap_file_node_departures');
    }
};
