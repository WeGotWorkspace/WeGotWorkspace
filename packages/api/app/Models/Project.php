<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * One Project of one Team (#817). Written only by the Projects services.
 *
 * @property string $id lower-case ULID
 * @property string $group_slug
 * @property string $slug
 * @property string $name
 * @property string|null $color
 * @property string|null $default_for_group
 * @property Carbon|null $archived_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class Project extends Model
{
    use UsesWgwConnection;

    protected $table = 'projects';

    public $incrementing = false;

    protected $keyType = 'string';

    /** @var list<string> */
    protected $fillable = [
        'id',
        'group_slug',
        'slug',
        'name',
        'color',
        'default_for_group',
        'archived_at',
    ];

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['archived_at' => 'datetime'];
    }

    /** @return HasMany<ProjectResource, $this> */
    public function resources(): HasMany
    {
        return $this->hasMany(ProjectResource::class, 'project_id');
    }
}
