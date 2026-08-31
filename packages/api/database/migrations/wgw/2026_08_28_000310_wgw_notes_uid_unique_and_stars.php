<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('calendarobjects')) {
            return;
        }

        $duplicates = DB::connection('wgw')->table('calendarobjects')
            ->select('calendarid', 'uid', DB::raw('COUNT(*) as total'))
            ->whereNotNull('uid')
            ->where('uid', '!=', '')
            ->groupBy('calendarid', 'uid')
            ->having('total', '>', 1)
            ->get();

        if ($duplicates->isNotEmpty()) {
            $report = $duplicates->map(
                static fn ($row): string => sprintf('calendarid=%s uid=%s count=%s', $row->calendarid, $row->uid, $row->total)
            )->implode('; ');
            throw new RuntimeException('Duplicate (calendarid, uid) rows block UNIQUE calendarid_uid: '.$report);
        }

        $this->wgw()->table('calendarobjects', function (Blueprint $table): void {
            $sm = $this->wgw();
            $indexes = collect($sm->getIndexes('calendarobjects'))->pluck('name')->all();
            if (! in_array('calendarid_uid', $indexes, true)) {
                $table->unique(['calendarid', 'uid'], 'calendarid_uid');
            }
        });

        if (! $this->wgwHasTable('note_stars')) {
            $this->wgw()->create('note_stars', function (Blueprint $table): void {
                $table->id();
                $table->string('username', 255);
                $table->unsignedInteger('calendar_object_id');
                $table->string('note_uid', 200);
                $table->unique(['username', 'calendar_object_id']);
                $table->index('note_uid');
                $table->foreign('calendar_object_id')
                    ->references('id')
                    ->on('calendarobjects')
                    ->onDelete('cascade');
            });
        }
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('note_stars');
        if ($this->wgwHasTable('calendarobjects')) {
            $this->wgw()->table('calendarobjects', function (Blueprint $table): void {
                $table->dropUnique('calendarid_uid');
            });
        }
    }
};
