<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Services\Search\SearchDocumentCollectionBackfill;
use Illuminate\Database\Schema\Blueprint;

/**
 * CalDAV and CardDAV search rows remember the collection (calendar instance
 * or address book) and object they came from. Search only returns such a row
 * while both are still live for the caller, so it follows a revoked or
 * dismissed share, a left group, or a deleted item at once.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('search_documents') || $this->wgwHasColumn('search_documents', 'collection_id')) {
            return;
        }

        $this->wgw()->table('search_documents', function (Blueprint $table): void {
            $table->unsignedBigInteger('collection_id')->nullable();
            $table->unsignedBigInteger('object_id')->nullable();
        });

        if ($this->wgwHasTable('calendarinstances') && $this->wgwHasTable('addressbooks')) {
            app(SearchDocumentCollectionBackfill::class)->run();
        }
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('search_documents') || ! $this->wgwHasColumn('search_documents', 'collection_id')) {
            return;
        }

        $this->wgw()->table('search_documents', function (Blueprint $table): void {
            $table->dropColumn(['collection_id', 'object_id']);
        });
    }
};
