<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property string $username
 * @property string $path
 * @property int $created_at
 */
final class DriveStarredItem extends Model
{
    use UsesWgwConnection;

    protected $table = 'drive_starred_items';

    public $incrementing = false;

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'username',
        'path',
        'created_at',
    ];
}
