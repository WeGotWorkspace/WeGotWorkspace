<?php

declare(strict_types=1);

namespace App\Database\Migrations;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Schema\Builder;

/**
 * The calendar_collection_meta table. Two migrations create it: the one that
 * introduced it, and an earlier-named one so that the provisioning data
 * migrations (which create collections through WgwCalendarBackend, and that
 * writes this table) can run on an install that predates them (#1076).
 */
final class CalendarCollectionMetaTable
{
    public const NAME = 'calendar_collection_meta';

    public static function ensure(Builder $schema): void
    {
        if ($schema->hasTable(self::NAME)) {
            return;
        }

        $schema->create(self::NAME, function (Blueprint $table): void {
            $table->unsignedInteger('calendarid')->primary();
            $table->string('kind', 32);
            $table->index('kind');
            $table->foreign('calendarid')
                ->references('id')
                ->on('calendars')
                ->onDelete('cascade');
        });
    }
}
