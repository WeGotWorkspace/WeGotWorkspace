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
 * Existing rows are backfilled with the principal that owns their calendar. Each step checks
 * its own state, so a run that stopped half way (DDL is not transactional) finishes on the
 * next run.
 */
return new class extends WgwMigration
{
    private const OLD_KEY = ['username', 'calendar_uri'];

    private const NEW_KEY = ['principal_uri', 'calendar_uri'];

    public function up(): void
    {
        if (! $this->wgwHasTable('calendar_subscriptions')) {
            return;
        }

        if (! $this->wgwHasColumn('calendar_subscriptions', 'principal_uri')) {
            $this->wgw()->table('calendar_subscriptions', function (Blueprint $table): void {
                $table->string('principal_uri', 255)->default('')->after('username');
            });
        }

        $this->backfillPrincipalUri();

        if ($this->wgw()->hasIndex('calendar_subscriptions', self::OLD_KEY, 'unique')) {
            $this->wgw()->table('calendar_subscriptions', function (Blueprint $table): void {
                $table->dropUnique(self::OLD_KEY);
            });
        }
        if (! $this->wgw()->hasIndex('calendar_subscriptions', self::NEW_KEY, 'unique')) {
            $this->wgw()->table('calendar_subscriptions', function (Blueprint $table): void {
                $table->unique(self::NEW_KEY);
            });
        }
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('calendar_subscriptions') || ! $this->wgwHasColumn('calendar_subscriptions', 'principal_uri')) {
            return;
        }

        $this->wgw()->table('calendar_subscriptions', function (Blueprint $table): void {
            $table->dropUnique(self::NEW_KEY);
            $table->unique(self::OLD_KEY);
            $table->dropColumn('principal_uri');
        });
    }

    /**
     * Rows whose calendar the user owns personally keep that principal. For the others the
     * Team calendar is picked by, in order: the user is a member of the Team, the calendar
     * name equals the row name, and no other row claimed it yet. A row that finds no free
     * Team calendar (its calendar was lost) falls back to the personal principal; the old key
     * allowed one row per user and uri, so that never collides.
     */
    private function backfillPrincipalUri(): void
    {
        $db = DB::connection('wgw');
        $rows = $db->table('calendar_subscriptions')
            ->where('principal_uri', '')
            ->orderBy('username')
            ->orderBy('id')
            ->get(['id', 'username', 'calendar_uri', 'name']);

        /** @var array<string, true> $claimed */
        $claimed = [];
        foreach ($db->table('calendar_subscriptions')->where('principal_uri', '!=', '')->get(['principal_uri', 'calendar_uri']) as $existing) {
            $claimed[$existing->principal_uri.'|'.$existing->calendar_uri] = true;
        }

        $assign = function (string $id, string $principalUri, string $calendarUri) use ($db, &$claimed): void {
            $db->table('calendar_subscriptions')->where('id', $id)->update(['principal_uri' => $principalUri]);
            $claimed[$principalUri.'|'.$calendarUri] = true;
        };

        $unresolved = [];
        foreach ($rows as $row) {
            $personal = 'principals/'.$row->username;
            $owned = $db->table('calendarinstances')
                ->where('principaluri', $personal)
                ->where('uri', $row->calendar_uri)
                ->where('access', 1)
                ->exists();
            if ($owned) {
                $assign($row->id, $personal, $row->calendar_uri);
            } else {
                $unresolved[] = $row;
            }
        }

        foreach ($unresolved as $row) {
            $candidates = $db->table('calendarinstances')
                ->where('principaluri', 'like', 'principals/groups/%')
                ->where('uri', $row->calendar_uri)
                ->where('access', 1)
                ->orderBy('id')
                ->get(['principaluri', 'displayname']);

            $members = $db->table('groupmembers')
                ->join('principals as g', 'g.id', '=', 'groupmembers.principal_id')
                ->join('principals as m', 'm.id', '=', 'groupmembers.member_id')
                ->where('m.uri', 'principals/'.$row->username)
                ->pluck('g.uri')
                ->all();

            $narrow = static function ($list, callable $keep) {
                $kept = $list->filter($keep)->values();

                return $kept->isEmpty() ? $list : $kept;
            };
            $candidates = $narrow($candidates, static fn ($c): bool => in_array($c->principaluri, $members, true));
            $candidates = $narrow($candidates, static fn ($c): bool => $row->name !== null && $c->displayname === $row->name);
            $free = $candidates->filter(fn ($c): bool => ! isset($claimed[$c->principaluri.'|'.$row->calendar_uri]))->values();

            $assign($row->id, $free->isEmpty() ? 'principals/'.$row->username : $free->first()->principaluri, $row->calendar_uri);
        }
    }
};
