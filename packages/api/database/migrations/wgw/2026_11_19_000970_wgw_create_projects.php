<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Projects on Teams (#817, spec 810-projects-on-teams).
 *
 * - `projects`: one row per Project. A Project belongs to exactly one Team
 *   (`group_slug`); it has no principal and no access rules of its own.
 *   `default_for_group` marks the Team's default Project, the way
 *   `chat_channel_meta.default_for_group` marks the Team channel.
 *   The slug stays reserved while a Project is archived.
 * - `project_resources`: the registry of what a Project bundles, at most one
 *   item per kind. The locator is `calendars.id` for the CalDAV-backed kinds
 *   (the same for the owner and every sharee instance) and the FileNode
 *   `node_id` for the Drive folder. A collection or folder is in one Project
 *   at most.
 * - `project_markers`: one change marker per Team, bumped on every Project
 *   write. It feeds the `Project` push state.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('projects')) {
            $this->wgw()->create('projects', function (Blueprint $table): void {
                $table->string('id', 26)->primary();
                $table->string('group_slug', 64);
                $table->string('slug', 96);
                $table->string('name', 255);
                $table->string('color', 16)->nullable();
                $table->string('default_for_group', 64)->nullable()->unique();
                $table->timestamp('archived_at')->nullable();
                $table->timestamps();
                $table->unique(['group_slug', 'slug']);
            });
        }

        if (! $this->wgwHasTable('project_resources')) {
            $this->wgw()->create('project_resources', function (Blueprint $table): void {
                $table->id();
                $table->string('project_id', 26);
                $table->string('kind', 16);
                $table->string('locator', 64);
                $table->unique(['project_id', 'kind']);
                $table->unique('locator');
                $table->foreign('project_id')->references('id')->on('projects')->cascadeOnDelete();
            });
        }

        if (! $this->wgwHasTable('project_markers')) {
            $this->wgw()->create('project_markers', function (Blueprint $table): void {
                $table->string('group_slug', 64)->primary();
                $table->unsignedBigInteger('marker')->default(0);
            });
        }
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('project_markers');
        $this->wgw()->dropIfExists('project_resources');
        $this->wgw()->dropIfExists('projects');
    }
};
