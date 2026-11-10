<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;

/**
 * Admin becomes a role per user (#1925). Every current member of the old
 * `administrators` group gets `users.is_admin`. The group, its members, its
 * channel, calendar, Drive folder and address book stay as they are: from now
 * on it is an ordinary Team called "Administrators".
 *
 * One-way for role changes: `down()` drops the column, so code from before
 * #1925 reads group membership again. Role changes made after `up()` are not
 * written back into the group.
 */
return new class extends WgwMigration
{
    private const LEGACY_ADMIN_GROUP_URI = 'principals/groups/administrators';

    public function up(): void
    {
        if (! $this->wgwHasTable('users')) {
            return;
        }

        if (! $this->wgwHasColumn('users', 'is_admin')) {
            $this->wgw()->table('users', function (Blueprint $table): void {
                $table->boolean('is_admin')->default(false);
            });
        }

        if (! $this->wgwHasTable('principals') || ! $this->wgwHasTable('groupmembers')) {
            return;
        }

        $memberUris = DB::connection('wgw')->table('groupmembers')
            ->join('principals as g', 'g.id', '=', 'groupmembers.principal_id')
            ->join('principals as m', 'm.id', '=', 'groupmembers.member_id')
            ->where('g.uri', self::LEGACY_ADMIN_GROUP_URI)
            ->pluck('m.uri');

        $usernames = [];
        foreach ($memberUris as $uri) {
            $uri = (string) $uri;
            if (str_starts_with($uri, 'principals/') && substr_count($uri, '/') === 1) {
                $usernames[] = substr($uri, strlen('principals/'));
            }
        }

        if ($usernames !== []) {
            DB::connection('wgw')->table('users')
                ->whereIn('username', $usernames)
                ->update(['is_admin' => true]);
        }
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('users') || ! $this->wgwHasColumn('users', 'is_admin')) {
            return;
        }

        $this->wgw()->table('users', function (Blueprint $table): void {
            $table->dropColumn('is_admin');
        });
    }
};
