<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('mail_user_credentials')) {
            return;
        }

        $this->wgw()->table('mail_user_credentials', function (Blueprint $table): void {
            if (! $this->wgwHasColumn('mail_user_credentials', 'imap_host')) {
                $table->string('imap_host')->default('');
            }
            if (! $this->wgwHasColumn('mail_user_credentials', 'imap_port')) {
                $table->unsignedInteger('imap_port')->default(993);
            }
            if (! $this->wgwHasColumn('mail_user_credentials', 'imap_security')) {
                $table->string('imap_security', 16)->default('ssl');
            }
            if (! $this->wgwHasColumn('mail_user_credentials', 'smtp_host')) {
                $table->string('smtp_host')->default('');
            }
            if (! $this->wgwHasColumn('mail_user_credentials', 'smtp_port')) {
                $table->unsignedInteger('smtp_port')->default(587);
            }
            if (! $this->wgwHasColumn('mail_user_credentials', 'smtp_security')) {
                $table->string('smtp_security', 16)->default('starttls');
            }
            if (! $this->wgwHasColumn('mail_user_credentials', 'smtp_username')) {
                $table->string('smtp_username')->default('');
            }
            if (! $this->wgwHasColumn('mail_user_credentials', 'smtp_password_enc')) {
                $table->text('smtp_password_enc')->nullable();
            }
        });

        $this->copyInstanceEndpointsOntoExistingRows();
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('mail_user_credentials')) {
            return;
        }

        $this->wgw()->table('mail_user_credentials', function (Blueprint $table): void {
            foreach ([
                'imap_host', 'imap_port', 'imap_security',
                'smtp_host', 'smtp_port', 'smtp_security',
                'smtp_username', 'smtp_password_enc',
            ] as $column) {
                if ($this->wgwHasColumn('mail_user_credentials', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }

    /**
     * One-shot: copy instance mail_imap_* / mail_smtp_* onto credential rows
     * that already have an IMAP username so live mailboxes keep working.
     */
    private function copyInstanceEndpointsOntoExistingRows(): void
    {
        if (! $this->wgwHasTable('app_settings')) {
            return;
        }

        $settings = [];
        foreach (DB::connection('wgw')->table('app_settings')->get(['name', 'value']) as $row) {
            $settings[(string) $row->name] = (string) $row->value;
        }

        $imapHost = trim($settings['mail_imap_host'] ?? '');
        $smtpHost = trim($settings['mail_smtp_host'] ?? '');
        if ($imapHost === '' && $smtpHost === '') {
            return;
        }

        $imapPort = (int) ($settings['mail_imap_port'] ?? 993);
        $smtpPort = (int) ($settings['mail_smtp_port'] ?? 587);
        $imapSec = strtolower(trim($settings['mail_imap_security'] ?? 'ssl')) ?: 'ssl';
        $smtpSec = strtolower(trim($settings['mail_smtp_security'] ?? 'starttls')) ?: 'starttls';

        DB::connection('wgw')->table('mail_user_credentials')
            ->where('imap_username', '!=', '')
            ->where('imap_host', '')
            ->update([
                'imap_host' => $imapHost,
                'imap_port' => $imapPort > 0 ? $imapPort : 993,
                'imap_security' => $imapSec,
                'smtp_host' => $smtpHost,
                'smtp_port' => $smtpPort > 0 ? $smtpPort : 587,
                'smtp_security' => $smtpSec,
            ]);
    }
};
