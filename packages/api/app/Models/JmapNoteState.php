<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

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
