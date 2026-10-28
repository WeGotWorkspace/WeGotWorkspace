<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property string $principal lower-case username, as on `notifications.principal`
 * @property int $marker
 */
final class NotificationMarker extends Model
{
    use UsesWgwConnection;

    protected $table = 'notification_markers';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = ['principal', 'marker'];
}
