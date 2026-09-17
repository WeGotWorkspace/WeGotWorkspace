<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('jmap_note_states')) {
            return;
        }

        $this->wgw()->create('jmap_note_states', function (Blueprint $table): void {
            $table->id();
            $table->string('username', 255);
            $table->string('note_id', 200);
            $table->string('notebook_uri', 255);
            $table->string('object_uri', 255)->nullable();
            $table->timestamps();

            $table->unique(['username', 'note_id']);
            $table->index(['username', 'notebook_uri']);
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('jmap_note_states');
    }
};
