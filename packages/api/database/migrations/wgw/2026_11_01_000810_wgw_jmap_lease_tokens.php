<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Owner of a lease (#1500). An assembly append, and a staged attach copy,
 * hold a lease while they write; releases and commits are conditional on the
 * token, so a call whose lease expired can neither clear nor write over the
 * call that took it next.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if ($this->wgwHasTable('jmap_blob_assemblies') && ! $this->wgwHasColumn('jmap_blob_assemblies', 'lease_token')) {
            $this->wgw()->table('jmap_blob_assemblies', function (Blueprint $table): void {
                $table->string('lease_token', 64)->nullable();
            });
        }
        if ($this->wgwHasTable('jmap_attach_staging') && ! $this->wgwHasColumn('jmap_attach_staging', 'lease_token')) {
            $this->wgw()->table('jmap_attach_staging', function (Blueprint $table): void {
                $table->timestamp('locked_until')->nullable();
                $table->string('lease_token', 64)->nullable();
            });
        }
    }

    public function down(): void
    {
        if ($this->wgwHasTable('jmap_blob_assemblies') && $this->wgwHasColumn('jmap_blob_assemblies', 'lease_token')) {
            $this->wgw()->table('jmap_blob_assemblies', function (Blueprint $table): void {
                $table->dropColumn('lease_token');
            });
        }
        if ($this->wgwHasTable('jmap_attach_staging') && $this->wgwHasColumn('jmap_attach_staging', 'lease_token')) {
            $this->wgw()->table('jmap_attach_staging', function (Blueprint $table): void {
                $table->dropColumn(['locked_until', 'lease_token']);
            });
        }
    }
};
