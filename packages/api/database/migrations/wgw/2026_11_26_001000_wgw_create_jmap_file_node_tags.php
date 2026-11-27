<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('jmap_file_node_tags')) {
            return;
        }
        $this->wgw()->create('jmap_file_node_tags', function (Blueprint $table): void {
            $table->id();
            // Keyed by node id, not path: a move or rename keeps the node, so
            // its tags stay without any rewrite.
            $table->string('node_id', 64);
            $table->string('tag', 255);
            $table->unique(['node_id', 'tag']);
            $table->index('tag');
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('jmap_file_node_tags');
    }
};
