<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Per-calendar Team availability choices (#1908): whether a calendar counts
 * (`include`) and how much teammates see (`detail`: busy or details). Keyed on
 * the collection id, so a Team calendar has one row per member. No row means
 * included and `busy`. Rows die with their calendar on every delete path.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('calendar_availability_prefs')) {
            return;
        }

        $this->wgw()->create('calendar_availability_prefs', function (Blueprint $table): void {
            $table->string('principal_uri', 255);
            $table->unsignedInteger('calendarid');
            $table->boolean('include')->default(true);
            $table->string('detail', 16)->default('busy');
            $table->timestamp('updated_at', 6);

            $table->primary(['principal_uri', 'calendarid']);
            $table->index('calendarid');
            $table->foreign('calendarid')
                ->references('id')
                ->on('calendars')
                ->onDelete('cascade');
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('calendar_availability_prefs');
    }
};
