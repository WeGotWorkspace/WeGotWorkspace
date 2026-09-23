<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

final class MailUserCredential extends Model
{
    use UsesWgwConnection;

    protected $table = 'mail_user_credentials';

    protected $primaryKey = 'username';

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'username',
        'imap_username',
        'password_enc',
        'imap_host',
        'imap_port',
        'imap_security',
        'smtp_host',
        'smtp_port',
        'smtp_security',
        'smtp_username',
        'smtp_password_enc',
        'updated_at',
    ];
}
