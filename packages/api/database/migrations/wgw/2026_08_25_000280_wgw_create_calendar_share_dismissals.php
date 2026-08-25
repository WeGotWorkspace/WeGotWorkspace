<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('calendar_share_dismissals')) {
            return;
        }

        $this->wgw()->create('calendar_share_dismissals', function (Blueprint $table): void {
            $table->id();
            $table->string('username', 255);
            $table->unsignedBigInteger('calendarid');
            $table->timestamp('dismissed_at');

            $table->unique(['username', 'calendarid']);
            $table->index('username');
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('calendar_share_dismissals');
    }
};
