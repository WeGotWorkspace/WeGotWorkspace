<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('addressbook_shares')) {
            $this->wgw()->create('addressbook_shares', function (Blueprint $table): void {
                $table->id();
                $table->unsignedBigInteger('addressbookid');
                $table->string('principaluri', 255);
                $table->string('href', 255);
                $table->unsignedTinyInteger('access');
                $table->string('displayname', 255)->nullable();

                $table->unique(['addressbookid', 'principaluri']);
                $table->index('principaluri');
                $table->index('addressbookid');
            });
        }

        if (! $this->wgwHasTable('addressbook_share_dismissals')) {
            $this->wgw()->create('addressbook_share_dismissals', function (Blueprint $table): void {
                $table->id();
                $table->string('username', 255);
                $table->unsignedBigInteger('addressbookid');
                $table->timestamp('dismissed_at');

                $table->unique(['username', 'addressbookid']);
                $table->index('username');
            });
        }
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('addressbook_share_dismissals');
        $this->wgw()->dropIfExists('addressbook_shares');
    }
};
