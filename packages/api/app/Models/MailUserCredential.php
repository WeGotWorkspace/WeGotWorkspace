<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property string $username
 * @property string $imap_username
 * @property string $password_enc
 * @property string $updated_at
 */
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
        'updated_at',
    ];
}
