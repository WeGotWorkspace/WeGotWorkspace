<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;

/**
 * Which markdown a Docs Yjs sidecar was saved with (#1349). The sidecar
 * bytes stay on disk beside the document.
 *
 * The unique key is the sha256 of `storage_key`: utf8mb4 varchar(1024) is
 * over InnoDB's key limit, and a prefix unique index would refuse two keys
 * that only differ after the prefix. The plain prefix index on `storage_key`
 * only narrows folder moves and deletes.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('doc_yjs_state')) {
            return;
        }

        $driver = DB::connection('wgw')->getDriverName();
        $this->wgw()->create('doc_yjs_state', function (Blueprint $table) use ($driver): void {
            $table->id();
            $table->string('storage_key', 1024);
            $table->string('storage_key_hash', 64)->unique();
            $table->string('content_etag', 64);
            $table->string('sidecar_etag', 64);
            $table->timestamps();

            // Folder moves and deletes select rows by key prefix.
            if ($driver === 'mysql') {
                // utf8mb4 varchar(1024) exceeds InnoDB's 3072-byte key limit.
                $table->rawIndex('`storage_key`(760)', 'doc_yjs_state_storage_key_index');
            } else {
                $table->index('storage_key');
            }
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('doc_yjs_state');
    }
};
