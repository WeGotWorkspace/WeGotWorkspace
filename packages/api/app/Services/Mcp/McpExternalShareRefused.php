<?php

declare(strict_types=1);

namespace App\Services\Mcp;

/**
 * Launch MCP tried to create or address a public link or guest invite.
 * The MCP tool handler records this as audit outcome "denied".
 */
final class McpExternalShareRefused extends \InvalidArgumentException {}
