<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

return new class extends WgwMigration
{
    public function up(): void
    {
        $this->addShareColumns();
        $this->addGrantColumns();
        $this->backfillShares();
        $this->backfillGrants();
    }

    public function down(): void
    {
        if ($this->wgwHasTable('drive_share_grants') && $this->wgwHasColumn('drive_share_grants', 'invite_token_hash')) {
            $this->wgw()->table('drive_share_grants', function (Blueprint $table): void {
                $table->dropColumn(['invite_token_hash', 'invite_token_cipher', 'invite_expires_at']);
            });
        }

        if ($this->wgwHasTable('drive_shares') && $this->wgwHasColumn('drive_shares', 'public_token_hash')) {
            $this->wgw()->table('drive_shares', function (Blueprint $table): void {
                $table->dropColumn(['public_token_hash', 'public_token_cipher']);
            });
        }
    }

    private function addShareColumns(): void
    {
        if (! $this->wgwHasTable('drive_shares') || $this->wgwHasColumn('drive_shares', 'public_token_hash')) {
            return;
        }

        $this->wgw()->table('drive_shares', function (Blueprint $table): void {
            $table->string('public_token_hash', 64)->nullable()->unique('uniq_drive_shares_public_token_hash');
            $table->text('public_token_cipher')->nullable();
        });
    }

    private function addGrantColumns(): void
    {
        if (! $this->wgwHasTable('drive_share_grants') || $this->wgwHasColumn('drive_share_grants', 'invite_token_hash')) {
            return;
        }

        $this->wgw()->table('drive_share_grants', function (Blueprint $table): void {
            $table->string('invite_token_hash', 64)->nullable()->unique('uniq_drive_share_grants_invite_token_hash');
            $table->text('invite_token_cipher')->nullable();
            $table->timestamp('invite_expires_at')->nullable();
        });
    }

    private function backfillShares(): void
    {
        if (! $this->wgwHasTable('drive_shares') || ! $this->wgwHasColumn('drive_shares', 'public_token_hash')) {
            return;
        }

        $rows = DB::connection('wgw')->table('drive_shares')
            ->whereNotNull('public_token')
            ->where('public_token', '!=', '')
            ->get(['id', 'public_token']);

        foreach ($rows as $row) {
            $id = $row->id ?? null;
            $token = $row->public_token ?? null;
            if ((! is_string($id) && ! is_int($id)) || ! is_string($token)) {
                continue;
            }

            $stored = trim($token);
            if ($stored === '') {
                DB::connection('wgw')->table('drive_shares')->where('id', $id)->update([
                    'public_token' => null,
                ]);

                continue;
            }

            DB::connection('wgw')->table('drive_shares')->where('id', $id)->update([
                'public_token_hash' => DriveShare::hashPublicToken($stored),
                'public_token_cipher' => Crypt::encryptString($stored),
                'public_token' => null,
            ]);
        }
    }

    private function backfillGrants(): void
    {
        if (! $this->wgwHasTable('drive_share_grants') || ! $this->wgwHasColumn('drive_share_grants', 'invite_token_hash')) {
            return;
        }

        $rows = DB::connection('wgw')->table('drive_share_grants')
            ->whereNotNull('invite_token')
            ->where('invite_token', '!=', '')
            ->get(['id', 'invite_token']);

        $expiresAt = Carbon::now()->addDays(DriveShareGrant::INVITE_TTL_DAYS);
        foreach ($rows as $row) {
            $id = $row->id ?? null;
            $token = $row->invite_token ?? null;
            if ((! is_string($id) && ! is_int($id)) || ! is_string($token)) {
                continue;
            }

            $stored = trim($token);
            if ($stored === '') {
                DB::connection('wgw')->table('drive_share_grants')->where('id', $id)->update([
                    'invite_token' => null,
                ]);

                continue;
            }

            DB::connection('wgw')->table('drive_share_grants')->where('id', $id)->update([
                'invite_token_hash' => DriveShareGrant::hashInviteToken($stored),
                'invite_token_cipher' => Crypt::encryptString($stored),
                'invite_expires_at' => $expiresAt,
                'invite_token' => null,
            ]);
        }
    }
};
