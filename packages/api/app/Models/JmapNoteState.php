<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property string $username
 * @property string $note_id
 * @property string $notebook_uri
 * @property string|null $object_uri
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class JmapNoteState extends Model
{
    use UsesWgwConnection;

    protected $table = 'jmap_note_states';

    protected $fillable = [
        'username',
        'note_id',
        'notebook_uri',
        'object_uri',
    ];
}
