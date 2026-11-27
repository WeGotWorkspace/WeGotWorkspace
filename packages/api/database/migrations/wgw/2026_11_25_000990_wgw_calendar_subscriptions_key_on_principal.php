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

        // The old key is unique on (username, calendar_uri). A personal and a Team subscription of
        // one member can share a uri, and nothing here may pick which row to drop.
        $clash = DB::connection('wgw')->table('calendar_subscriptions')
            ->select('username', 'calendar_uri')
            ->groupBy('username', 'calendar_uri')
            ->havingRaw('COUNT(*) > 1')
            ->exists();
        if ($clash) {
            throw new RuntimeException('Cannot restore the old calendar_subscriptions key: a member has two subscriptions with the same calendar uri. Remove one first.');
        }

        $this->wgw()->table('calendar_subscriptions', function (Blueprint $table): void {
            $table->dropUnique(self::NEW_KEY);
            $table->unique(self::OLD_KEY);
            $table->dropColumn('principal_uri');
        });
    }

    /**
     * Candidates are the user's own owner instance and owner instances on Teams the user
     * belongs to. One candidate gets the row, whatever its name. Several candidates get it only
     * when exactly one display name equals the row name. Otherwise the row is parked on a
     * principal no calendar resolves from, so a refresh 404s instead of overwriting a guess.
     * No candidate at all (the calendar was lost) keeps the personal principal.
     *
     * Every row is settled first. When several rows pick the same (principal, uri), or a row
     * filled by an earlier run already holds it, all the new rows of that pair are parked the
     * same way: a refresh would otherwise overwrite the calendar with the feed of a row that
     * may not own it, and the unique key could not be added.
     */
    private function backfillPrincipalUri(): void
    {
        $db = DB::connection('wgw');
        $rows = $db->table('calendar_subscriptions')
            ->where('principal_uri', '')
            ->orderBy('username')
            ->orderBy('id')
            ->get(['id', 'username', 'calendar_uri', 'name']);

        $held = [];
        foreach ($db->table('calendar_subscriptions')->where('principal_uri', '!=', '')->get(['principal_uri', 'calendar_uri']) as $filled) {
            $held[$filled->principal_uri."\0".$filled->calendar_uri] = 1;
        }

        $picked = [];
        $counts = [];
        foreach ($rows as $row) {
            $personal = 'principals/'.$row->username;
            $members = $db->table('groupmembers')
                ->join('principals as g', 'g.id', '=', 'groupmembers.principal_id')
                ->join('principals as m', 'm.id', '=', 'groupmembers.member_id')
                ->where('m.uri', $personal)
                ->pluck('g.uri')
                ->all();

            $candidates = $db->table('calendarinstances')
                ->where('uri', $row->calendar_uri)
                ->where('access', 1)
                ->where(function ($query) use ($personal, $members): void {
                    $query->where('principaluri', $personal);
                    if ($members !== []) {
                        $query->orWhereIn('principaluri', $members);
                    }
                })
                ->orderBy('id')
                ->get(['principaluri', 'displayname']);

            $ownsPersonal = $candidates->contains(fn ($c): bool => $c->principaluri === $personal);
            $principalUri = $personal;
            if ($candidates->count() === 1) {
                $principalUri = (string) $candidates->first()?->principaluri;
            } elseif ($candidates->count() > 1) {
                $named = $candidates->filter(fn ($c): bool => $row->name !== null && $c->displayname === $row->name)->values();
                if ($named->count() === 1) {
                    $principalUri = (string) $named->first()?->principaluri;
                } elseif ($ownsPersonal) {
                    $principalUri = $personal.'#unresolved-'.$row->id;
                }
            }

            $parked = $ownsPersonal ? $personal.'#unresolved-'.$row->id : $personal;
            $picked[$row->id] = [$principalUri, $parked, $principalUri."\0".$row->calendar_uri];
            $counts[$picked[$row->id][2]] = ($counts[$picked[$row->id][2]] ?? 0) + 1;
        }

        // One transaction: a stopped run must not leave some rows of a contested pair written,
        // or the rerun would see the rest as uncontested.
        $db->transaction(function () use ($db, $picked, $counts, $held): void {
            foreach ($picked as $id => [$principalUri, $parked, $pair]) {
                $contested = $counts[$pair] > 1 || isset($held[$pair]);
                $db->table('calendar_subscriptions')->where('id', $id)->update(['principal_uri' => $contested ? $parked : $principalUri]);
            }
        });
    }
};
