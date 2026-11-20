<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * One item a Project bundles (#817). `locator` is `calendars.id` for the
 * CalDAV-backed kinds and the FileNode `node_id` for the Drive folder.
 *
 * @property int $id
 * @property string $project_id
 * @property string $kind
 * @property string $locator
 */
final class ProjectResource extends Model
{
    use UsesWgwConnection;

    protected $table = 'project_resources';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = ['project_id', 'kind', 'locator'];
}
