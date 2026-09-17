<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('chat_channel_meta') || $this->wgwHasColumn('chat_channel_meta', 'default_for_group')) {
            return;
        }

        // Marks a channel as THE default chat channel of an ACL group (Epic
        // #701 chunk M): provisioned by ChatGroupDefaultChannelProvisioner,
        // owned by the group principal, immutable through the generic channel
        // endpoints (like DMs). The unique index enforces one default per
        // group even under concurrent provisioning; NULLs (regular channels)
        // are exempt on both sqlite and mysql.
        $this->wgw()->table('chat_channel_meta', function (Blueprint $table): void {
            $table->string('default_for_group', 64)->nullable();
            $table->unique('default_for_group');
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('chat_channel_meta') || ! $this->wgwHasColumn('chat_channel_meta', 'default_for_group')) {
            return;
        }

        $this->wgw()->table('chat_channel_meta', function (Blueprint $table): void {
            $table->dropUnique(['default_for_group']);
            $table->dropColumn('default_for_group');
        });
    }
};
