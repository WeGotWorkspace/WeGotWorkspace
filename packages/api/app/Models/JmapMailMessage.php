<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

final class JmapMailMessage extends Model
{
    use UsesWgwConnection;

    protected $table = 'jmap_mail_messages';

    public $incrementing = false;

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'username',
        'mail_account_id',
        'mailbox',
        'uid',
        'flags_hash',
        'message_id_hash',
        'thread_key',
        'internaldate',
    ];
}
