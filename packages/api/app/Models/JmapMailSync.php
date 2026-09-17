<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

final class JmapMailSync extends Model
{
    use UsesWgwConnection;

    protected $table = 'jmap_mail_sync';

    public $incrementing = false;

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'username',
        'mail_account_id',
        'mailbox',
        'uidvalidity',
        'last_seen_uidnext',
        'window_flags_hash',
        'updated_at',
    ];
}
