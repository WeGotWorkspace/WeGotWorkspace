<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;

/**
 * Calendar uris are only unique per owning principal, so a personal calendar and a Team
 * calendar (or two Teams) can share one. The subscription key now includes the owner
 * principal instead of the subscribing user.
 *
 * Existing rows are backfilled with the principal that owns their calendar: the user's
 * personal principal when it has a calendar with that uri, otherwise the one Team calendar
 * that has it.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('calendar_subscriptions') || $this->wgwHasColumn('calendar_subscriptions', 'principal_uri')) {
            return;
        }

        $this->wgw()->table('calendar_subscriptions', function (Blueprint $table): void {
            $table->string('principal_uri', 255)->default('')->after('username');
        });

        $this->backfillPrincipalUri();

        $this->wgw()->table('calendar_subscriptions', function (Blueprint $table): void {
            $table->dropUnique(['username', 'calendar_uri']);
            $table->unique(['principal_uri', 'calendar_uri']);
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('calendar_subscriptions') || ! $this->wgwHasColumn('calendar_subscriptions', 'principal_uri')) {
            return;
        }

        $this->wgw()->table('calendar_subscriptions', function (Blueprint $table): void {
            $table->dropUnique(['principal_uri', 'calendar_uri']);
            $table->unique(['username', 'calendar_uri']);
            $table->dropColumn('principal_uri');
        });
    }

    private function backfillPrincipalUri(): void
    {
        $db = DB::connection('wgw');
        foreach ($db->table('calendar_subscriptions')->get(['id', 'username', 'calendar_uri']) as $row) {
            $personal = 'principals/'.$row->username;
            $owned = fn (string $principalUri): bool => $db->table('calendarinstances')
                ->where('principaluri', $principalUri)
                ->where('uri', $row->calendar_uri)
                ->where('access', 1)
                ->exists();

            $principalUri = $personal;
            if (! $owned($personal)) {
                $team = $db->table('calendarinstances')
                    ->where('principaluri', 'like', 'principals/groups/%')
                    ->where('uri', $row->calendar_uri)
                    ->where('access', 1)
                    ->orderBy('id')
                    ->value('principaluri');
                $principalUri = is_string($team) ? $team : $personal;
            }

            $db->table('calendar_subscriptions')->where('id', $row->id)->update(['principal_uri' => $principalUri]);
        }
    }
};
