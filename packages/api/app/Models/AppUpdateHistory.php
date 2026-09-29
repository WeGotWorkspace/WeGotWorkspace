<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property string $from_version
 * @property string $to_version
 * @property string $status
 * @property string $message
 * @property string $created_at
 */
final class AppUpdateHistory extends Model
{
    use UsesWgwConnection;

    protected $table = 'app_update_history';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'from_version',
        'to_version',
        'status',
        'message',
        'created_at',
    ];
}
