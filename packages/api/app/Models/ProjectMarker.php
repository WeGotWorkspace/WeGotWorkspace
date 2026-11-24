<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Change marker of one Team's Projects (#817): the `Project` push state.
 *
 * @property string $group_slug
 * @property int $marker
 */
final class ProjectMarker extends Model
{
    use UsesWgwConnection;

    protected $table = 'project_markers';

    protected $primaryKey = 'group_slug';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = ['group_slug', 'marker'];
}
