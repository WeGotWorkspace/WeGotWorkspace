<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Several selected items as one zip (#1905): a selection ticket stores its
 * node ids as a JSON list. Null means a folder ticket (#1621), bound to
 * `node_id` alone.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('drive_folder_download_tickets') || $this->wgwHasColumn('drive_folder_download_tickets', 'node_ids')) {
            return;
        }

        $this->wgw()->table('drive_folder_download_tickets', function (Blueprint $table): void {
            $table->text('node_ids')->nullable();
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('drive_folder_download_tickets') || ! $this->wgwHasColumn('drive_folder_download_tickets', 'node_ids')) {
            return;
        }

        $this->wgw()->table('drive_folder_download_tickets', function (Blueprint $table): void {
            $table->dropColumn('node_ids');
        });
    }
};
