<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use App\Services\Teams\TeamRoles;
use Illuminate\Database\Eloquent\Model;

/**
 * One team admin of one Team (#2278). Read only through {@see TeamRoles}.
 *
 * @property int $id
 * @property string $group_slug
 * @property string $username
 */
final class TeamAdmin extends Model
{
    use UsesWgwConnection;

    protected $table = 'team_admins';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'group_slug',
        'username',
    ];
}
