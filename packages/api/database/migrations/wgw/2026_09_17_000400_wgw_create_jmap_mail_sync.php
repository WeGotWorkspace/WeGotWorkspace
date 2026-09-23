<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('jmap_mail_sync')) {
            $this->wgw()->create('jmap_mail_sync', function (Blueprint $table): void {
                $table->string('username', 255);
                $table->string('mail_account_id', 64);
                // utf8mb4 PK (username + mail_account_id + mailbox [+ uid]) must stay under 3072 bytes.
                $table->string('mailbox', 440);
                $table->unsignedBigInteger('uidvalidity')->default(0);
                $table->unsignedBigInteger('last_seen_uidnext')->default(0);
                $table->string('window_flags_hash', 64)->default('');
                $table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();

                $table->primary(['username', 'mail_account_id', 'mailbox'], 'jmap_mail_sync_pk');
            });
        }

        if (! $this->wgwHasTable('jmap_mail_messages')) {
            $this->wgw()->create('jmap_mail_messages', function (Blueprint $table): void {
                $table->string('username', 255);
                $table->string('mail_account_id', 64);
                $table->string('mailbox', 440);
                $table->unsignedBigInteger('uid');
                $table->string('flags_hash', 64)->default('');
                $table->string('message_id_hash', 64)->default('');
                $table->string('thread_key', 64)->default('');
                $table->string('internaldate', 64)->nullable();

                $table->primary(['username', 'mail_account_id', 'mailbox', 'uid'], 'jmap_mail_messages_pk');
                $table->index(['username', 'mail_account_id', 'thread_key'], 'jmap_mail_messages_thread');
            });
        }
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('jmap_mail_messages');
        $this->wgw()->dropIfExists('jmap_mail_sync');
    }
};
