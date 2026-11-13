<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Calendar reply mailboxes (#1589): one IMAP mailbox per user, read for
 * invitation replies. Also drops what the removed mail client left behind
 * (#1573): the `mail_user_credentials` table and the `mail_imap_*` settings.
 *
 * down() drops the new table and does not bring the old credentials back:
 * nothing reads them since #1573, so this half is one-way.
 */
return new class extends WgwMigration
{
    private const LEGACY_SETTINGS = ['mail_imap_host', 'mail_imap_port', 'mail_imap_security'];

    public function up(): void
    {
        if (! $this->wgwHasTable('calendar_reply_mailboxes')) {
            $this->wgw()->create('calendar_reply_mailboxes', function (Blueprint $table): void {
                $table->string('username', 191)->primary();
                $table->string('host', 255);
                $table->unsignedInteger('port');
                $table->string('security', 16);
                $table->string('login', 320);
                $table->text('password_enc');
                $table->string('folder', 255)->default('INBOX');
                $table->string('trusted_server_id', 255)->default('');
                $table->boolean('enabled')->default(true);
                $table->unsignedBigInteger('uidvalidity')->nullable();
                $table->unsignedBigInteger('last_uid')->nullable();
                $table->unsignedBigInteger('last_polled_at')->nullable()->index();
                $table->unsignedBigInteger('last_success_at')->nullable();
                $table->string('last_error_code', 32)->nullable();
                $table->unsignedBigInteger('last_error_at')->nullable();
                $table->unsignedInteger('auth_failures')->default(0);
                $table->unsignedBigInteger('updated_at');
            });
        }

        $this->wgw()->dropIfExists('mail_user_credentials');
        if ($this->wgwHasTable('app_settings')) {
            $this->wgw()->getConnection()->table('app_settings')->whereIn('name', self::LEGACY_SETTINGS)->delete();
        }
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('calendar_reply_mailboxes');
    }
};
